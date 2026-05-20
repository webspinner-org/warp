/**
 * Vault master-key rotation — TypeScript port of the bash script at
 * tools/rotate-vault-key. Powers the /admin/vault-rotation admin
 * surface so the Wizard can rotate without ssh + terminal.
 *
 * The new key is generated server-side, never returned in the
 * response body — only an opaque fingerprint (first 8 hex of
 * SHA-256). The actual key value is written into the plists and
 * stored in PB-encrypted form for the vault_secrets rows; nothing
 * leaks back to the UI or client.
 *
 * What this function does:
 *   1. Authenticate to operator PB with current admin creds.
 *   2. Pull every vault_secrets row; backup the snapshot to
 *      ~/.warp-key-rotation/<ts>/vault_secrets.json.
 *   3. Decrypt each with OLD_KEY; abort if any row fails.
 *   4. Generate NEW_KEY (32 random bytes); self-check encrypt+decrypt.
 *   5. Re-encrypt each row with NEW_KEY; PATCH PB.
 *   6. Re-read + decrypt with NEW_KEY; abort if any mismatch.
 *   7. Backup the three plists.
 *   8. Rewrite the three plists (loom, loom-demo, hub) with NEW_KEY
 *      across all three relevant env var names.
 *   9. Return a result with backup path, row count, new fingerprint,
 *      restart instructions.
 *
 * What this function deliberately does NOT do:
 *   - Restart the launchd services. Doing so from inside the
 *     operator Loom would kill its own process mid-response. The
 *     admin UI surfaces a "Run tools/deploy-loom to restart" hint;
 *     a future iteration can spawn a detached helper.
 *
 * Idempotent on retry: if rotation succeeded but plist write failed
 * (vault is on NEW_KEY but plists still on OLD), the running service
 * will fail decrypt; re-running with OLD_KEY = the NEW key from the
 * vault won't work — the safe recovery is restoring from backup_dir.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { decryptValue, encryptValue } from './crypto.js';

const PB_OPERATOR_URL =
  process.env['WARP_VAULT_LOOKUP_URL'] ?? process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const PB_OPERATOR_EMAIL =
  process.env['WARP_VAULT_LOOKUP_EMAIL'] ?? process.env['WARP_PB_EMAIL'] ?? '';
const PB_OPERATOR_PASS =
  process.env['WARP_VAULT_LOOKUP_PASSWORD'] ?? process.env['WARP_PB_PASSWORD'] ?? '';
const OLD_KEY = process.env['WARP_VAULT_MASTER_KEY'] ?? '';

interface PBVaultRow {
  readonly id: string;
  readonly name: string;
  readonly ciphertext: string;
  readonly iv: string;
}

interface PlistTarget {
  readonly path: string;
  readonly keys: readonly string[];
}

const HOME = homedir();
const PLISTS: readonly PlistTarget[] = [
  {
    path: path.join(HOME, 'Library', 'LaunchAgents', 'foundation.webspinner.loom.plist'),
    keys: ['WARP_VAULT_MASTER_KEY'],
  },
  {
    path: path.join(HOME, 'Library', 'LaunchAgents', 'foundation.webspinner.loom-demo.plist'),
    keys: ['WARP_VAULT_MASTER_KEY', 'WARP_HUB_COOKIE_KEY', 'WARP_VAULT_LOOKUP_MASTER_KEY'],
  },
  {
    path: path.join(HOME, 'Library', 'LaunchAgents', 'com.webspinner.hub.plist'),
    keys: ['WARP_VAULT_MASTER_KEY'],
  },
];

export interface VaultRotationResult {
  readonly ok: true;
  readonly backupDir: string;
  readonly rowsRotated: number;
  readonly plistsRewritten: number;
  readonly newKeyFingerprint: string;
  readonly oldKeyFingerprint: string;
  readonly restartInstruction: string;
}

export interface VaultRotationError {
  readonly ok: false;
  readonly phase: string;
  readonly reason: string;
  readonly backupDir?: string;
}

function fingerprint(keyB64: string): string {
  return createHash('sha256').update(keyB64).digest('hex').slice(0, 8);
}

async function pbAuth(fetchFn: typeof fetch): Promise<string | null> {
  if (!PB_OPERATOR_EMAIL || !PB_OPERATOR_PASS) return null;
  const r = await fetchFn(`${PB_OPERATOR_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_OPERATOR_EMAIL, password: PB_OPERATOR_PASS }),
  });
  if (!r.ok) return null;
  const body = (await r.json()) as { token?: string };
  return body.token ?? null;
}

async function rewritePlist(p: PlistTarget, newKey: string): Promise<number> {
  const text = await fs.readFile(p.path, 'utf8');
  let next = text;
  let count = 0;
  for (const k of p.keys) {
    // single-line: <key>K</key><string>V</string>
    const single = new RegExp(`(<key>${k}</key>)\\s*<string>[^<]*</string>`, 'g');
    next = next.replace(single, (_m, prefix) => {
      count++;
      return `${prefix}<string>${newKey}</string>`;
    });
    // multi-line: <key>K</key>\n<whitespace><string>V</string>
    const multi = new RegExp(`(<key>${k}</key>\\s*\\n\\s*)<string>[^<]*</string>`, 'g');
    next = next.replace(multi, (_m, prefix) => {
      count++;
      return `${prefix}<string>${newKey}</string>`;
    });
  }
  await fs.writeFile(p.path, next, 'utf8');
  return count;
}

export async function rotateVaultKey(
  fetchFn: typeof fetch,
): Promise<VaultRotationResult | VaultRotationError> {
  if (!OLD_KEY) {
    return { ok: false, phase: 'precheck', reason: 'WARP_VAULT_MASTER_KEY not in environment' };
  }
  if (!PB_OPERATOR_EMAIL || !PB_OPERATOR_PASS) {
    return { ok: false, phase: 'precheck', reason: 'PB credentials missing from environment' };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const backupDir = path.join(HOME, '.warp-key-rotation', ts);
  await fs.mkdir(backupDir, { recursive: true });

  // 1. Auth to operator PB.
  const token = await pbAuth(fetchFn);
  if (!token) {
    return { ok: false, phase: 'pb-auth', reason: 'failed to auth as PB superuser', backupDir };
  }

  // 2. List vault_secrets + snapshot.
  const listRes = await fetchFn(
    `${PB_OPERATOR_URL}/api/collections/vault_secrets/records?perPage=500`,
    { headers: { Authorization: token } },
  );
  if (!listRes.ok) {
    return { ok: false, phase: 'pb-list', reason: `HTTP ${listRes.status}`, backupDir };
  }
  const listBody = (await listRes.json()) as { items?: readonly PBVaultRow[]; totalItems?: number };
  const rows = listBody.items ?? [];
  await fs.writeFile(
    path.join(backupDir, 'vault_secrets.json'),
    JSON.stringify(listBody, null, 2),
    'utf8',
  );

  // 3. Decrypt every row with OLD_KEY — bail on any failure.
  const plaintexts: { id: string; name: string; plain: string }[] = [];
  for (const row of rows) {
    try {
      const plain = await decryptValue(OLD_KEY, { ciphertext: row.ciphertext, iv: row.iv });
      plaintexts.push({ id: row.id, name: row.name, plain });
    } catch (e) {
      return {
        ok: false,
        phase: 'decrypt-old',
        reason: `cannot decrypt "${row.name}" with current key: ${(e as Error).message}`,
        backupDir,
      };
    }
  }

  // 4. Generate NEW_KEY + self-check.
  const newKey = randomBytes(32).toString('base64');
  try {
    const probeCipher = await encryptValue(newKey, 'ROTATION-PROBE');
    const probePlain = await decryptValue(newKey, probeCipher);
    if (probePlain !== 'ROTATION-PROBE') {
      return { ok: false, phase: 'new-key-self-check', reason: 'round-trip mismatch', backupDir };
    }
  } catch (e) {
    return {
      ok: false,
      phase: 'new-key-self-check',
      reason: (e as Error).message,
      backupDir,
    };
  }

  // 5. Re-encrypt + PATCH every row.
  for (const row of plaintexts) {
    const enc = await encryptValue(newKey, row.plain);
    const patch = await fetchFn(
      `${PB_OPERATOR_URL}/api/collections/vault_secrets/records/${row.id}`,
      {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ciphertext: enc.ciphertext, iv: enc.iv }),
      },
    );
    if (!patch.ok) {
      return {
        ok: false,
        phase: 'pb-patch',
        reason: `failed PATCH for "${row.name}": HTTP ${patch.status}`,
        backupDir,
      };
    }
  }

  // 6. Verify by reading back + decrypting with NEW_KEY.
  const verifyRes = await fetchFn(
    `${PB_OPERATOR_URL}/api/collections/vault_secrets/records?perPage=500`,
    { headers: { Authorization: token } },
  );
  if (verifyRes.ok) {
    const verifyBody = (await verifyRes.json()) as { items?: readonly PBVaultRow[] };
    for (const row of verifyBody.items ?? []) {
      try {
        const plain = await decryptValue(newKey, { ciphertext: row.ciphertext, iv: row.iv });
        const orig = plaintexts.find((p) => p.id === row.id);
        if (!orig || plain !== orig.plain) {
          return {
            ok: false,
            phase: 'round-trip',
            reason: `mismatch on "${row.name}"`,
            backupDir,
          };
        }
      } catch (e) {
        return {
          ok: false,
          phase: 'round-trip',
          reason: `cannot decrypt "${row.name}" with new key: ${(e as Error).message}`,
          backupDir,
        };
      }
    }
  }

  // 7. Backup plists.
  let plistsRewritten = 0;
  for (const p of PLISTS) {
    try {
      const text = await fs.readFile(p.path, 'utf8');
      await fs.writeFile(path.join(backupDir, path.basename(p.path)), text, 'utf8');
    } catch {
      // Missing plist (e.g., hub on a host that doesn't run hub) —
      // skip, no backup needed.
    }
  }

  // 8. Rewrite plists.
  for (const p of PLISTS) {
    try {
      const n = await rewritePlist(p, newKey);
      if (n > 0) plistsRewritten++;
    } catch {
      // ENOENT is fine — plist doesn't exist on this host. The
      // service it would launch isn't running here.
    }
  }

  return {
    ok: true,
    backupDir,
    rowsRotated: plaintexts.length,
    plistsRewritten,
    newKeyFingerprint: fingerprint(newKey),
    oldKeyFingerprint: fingerprint(OLD_KEY),
    restartInstruction:
      'Vault and plists are rotated. The currently-running services are still using the OLD key in memory. To pick up the NEW key, run `bash ~/warp/tools/deploy-loom` from a terminal (rebuilds + bootout/bootstraps both Looms + hub).',
  };
}

export interface VaultStatus {
  readonly rowCount: number;
  readonly oldKeyFingerprint: string;
  readonly lastRotationDir: string | null;
  readonly lastRotationAt: string | null;
}

export async function getVaultStatus(fetchFn: typeof fetch): Promise<VaultStatus> {
  let rowCount = 0;
  const token = await pbAuth(fetchFn);
  if (token) {
    const r = await fetchFn(`${PB_OPERATOR_URL}/api/collections/vault_secrets/records?perPage=1`, {
      headers: { Authorization: token },
    });
    if (r.ok) {
      const b = (await r.json()) as { totalItems?: number };
      rowCount = b.totalItems ?? 0;
    }
  }
  // Last rotation = newest directory under ~/.warp-key-rotation/.
  const rotDir = path.join(HOME, '.warp-key-rotation');
  let lastRotationDir: string | null = null;
  let lastRotationAt: string | null = null;
  try {
    const entries = await fs.readdir(rotDir);
    if (entries.length > 0) {
      entries.sort();
      const newest = entries[entries.length - 1];
      if (newest) {
        lastRotationDir = path.join(rotDir, newest);
        const st = await fs.stat(lastRotationDir);
        lastRotationAt = st.mtime.toISOString();
      }
    }
  } catch {
    // No rotation history yet — fine.
  }
  return {
    rowCount,
    oldKeyFingerprint: OLD_KEY ? fingerprint(OLD_KEY) : '(unset)',
    lastRotationDir,
    lastRotationAt,
  };
}
