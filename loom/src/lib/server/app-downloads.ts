/**
 * wp_app_downloads — one row per standalone download.
 *
 * Used by the Account Status panel (per-patron tally) and by the
 * Wizard-side abuse monitor (later). Never blocks the download —
 * if PB is down, the patron still gets their file.
 *
 * No raw IPs stored; ip_hash is the first 16 hex chars of SHA-256
 * over the connecting IP. Enough to count distinct sources without
 * being a meaningful PII store.
 */

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const COLLECTION = 'wp_app_downloads';

interface LogDownloadInput {
  readonly shortCode: string;
  readonly installTokenPrefix: string;
  readonly version: number;
  readonly userAgent: string;
  readonly ipHash: string;
  readonly fetchFn: typeof fetch;
  readonly token: string;
}

async function ensureCollection(fetchFn: typeof fetch, token: string): Promise<void> {
  const head = await fetchFn(`${PB_URL}/api/collections/${COLLECTION}`, {
    headers: { Authorization: token },
  });
  if (head.ok) return;
  if (head.status !== 404) return; // ignore other errors; non-fatal

  await fetchFn(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'short_code', type: 'text', required: true, max: 32 },
        { name: 'install_token_prefix', type: 'text', required: false, max: 16 },
        { name: 'version', type: 'number', required: false },
        { name: 'user_agent', type: 'text', required: false, max: 256 },
        { name: 'ip_hash', type: 'text', required: false, max: 32 },
        { name: 'downloaded_at', type: 'text', required: true, max: 32 },
        { name: 'created', type: 'autodate', system: true, onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', system: true, onCreate: true, onUpdate: true },
      ],
      indexes: [
        `CREATE INDEX idx_${COLLECTION}_short_code ON ${COLLECTION} (short_code, downloaded_at DESC)`,
      ],
    }),
  });
}

export async function logDownload(input: LogDownloadInput): Promise<void> {
  try {
    await ensureCollection(input.fetchFn, input.token);
    await input.fetchFn(`${PB_URL}/api/collections/${COLLECTION}/records`, {
      method: 'POST',
      headers: { Authorization: input.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        short_code: input.shortCode,
        install_token_prefix: input.installTokenPrefix,
        version: input.version,
        user_agent: input.userAgent,
        ip_hash: input.ipHash,
        downloaded_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Logging is best-effort. A failed log must not break the download.
  }
}

/**
 * Count downloads per short_code for a set of codes the patron owns.
 * Returns { shortCode → count }. Used by the Account Status panel.
 */
export async function countDownloadsByShortCode(
  fetchFn: typeof fetch,
  token: string,
  shortCodes: readonly string[],
): Promise<Record<string, number>> {
  if (shortCodes.length === 0) return {};
  const orClauses = shortCodes.map((c) => `short_code = ${JSON.stringify(c)}`).join(' || ');
  const url = `${PB_URL}/api/collections/${COLLECTION}/records?perPage=500&filter=${encodeURIComponent(orClauses)}`;
  try {
    const r = await fetchFn(url, { headers: { Authorization: token } });
    if (!r.ok) return {};
    const body = (await r.json()) as { items?: readonly { short_code: string }[] };
    const counts: Record<string, number> = {};
    for (const row of body.items ?? []) {
      counts[row.short_code] = (counts[row.short_code] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}
