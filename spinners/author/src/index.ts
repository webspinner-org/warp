/**
 * Author — the authoring Spinner of the Warp build loop.
 *
 * Capability: `authorSpinner({ slug, displayName, description, intent?, template?, scope? })`
 *
 * Five phases: scaffold → scenario-written → install → verify → report.
 *
 * v0 is template-driven. The `intent` field is recorded but does not
 * yet drive LLM-assisted scaffold variation; v1 wires that up. The
 * shape of the loop is the deliverable: brief in → verified Spinner +
 * scenario out, with Witness as the empirical gate.
 *
 * Runtime: in-process inside the Loom. Author calls scaffoldFromTemplate
 * and installSpinnerBundle from the Loom's server lib; it calls Witness
 * via the live HTTP invoke endpoint (so the orchestration goes through
 * the same audited surface a Wizard would use).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface AuthorInput {
  readonly slug: string;
  readonly displayName: string;
  readonly description: string;
  readonly intent?: string;
  readonly template?: string;
  readonly scope?: string;
}

export type AuthorPhase =
  | 'scaffolded'
  | 'scenario-written'
  | 'installed'
  | 'verified'
  | 'critiqued'
  | 'failed';

export interface AuthorOutput {
  readonly ok: boolean;
  readonly slug: string;
  readonly scenarioSlug?: string;
  readonly bundlePath?: string;
  readonly skeinName?: string;
  readonly phase: AuthorPhase;
  readonly witnessReport?: Record<string, unknown>;
  readonly pabloReport?: Record<string, unknown>;
  readonly errorKind?: string;
  readonly errorDetail?: string;
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const SCOPE_PATTERN = /^@[a-z0-9-]+$/;
const DEFAULT_SCOPE = '@local';
const DEFAULT_TEMPLATE = 'hello-spinner';
const DEFAULT_LOOM_BASE = process.env['WARP_LOOM_BASE'] ?? 'http://johns-mac-studio.local:3000';
const DEFAULT_PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

function readBootstrap(name: string): string | null {
  try {
    return readFileSync(join(homedir(), '.warp/bootstrap', name), 'utf8').trim();
  } catch {
    return null;
  }
}

function scenariosDir(): string {
  return process.env['WARP_SCENARIOS_DIR'] ?? join(homedir(), 'warp', 'scenarios');
}

export async function authorSpinner(input: AuthorInput): Promise<AuthorOutput> {
  // Validate.
  if (!SLUG_PATTERN.test(input.slug)) {
    return fail(
      input.slug,
      'failed',
      'invalid-slug',
      `slug "${input.slug}" does not match ${SLUG_PATTERN}`,
    );
  }
  const scope = input.scope ?? DEFAULT_SCOPE;
  if (!SCOPE_PATTERN.test(scope)) {
    return fail(
      input.slug,
      'failed',
      'invalid-scope',
      `scope "${scope}" does not match ${SCOPE_PATTERN}`,
    );
  }
  const templateName = input.template ?? DEFAULT_TEMPLATE;
  if (templateName !== 'hello-spinner') {
    return fail(
      input.slug,
      'failed',
      'unsupported-template',
      `v0 supports 'hello-spinner' only; got "${templateName}"`,
    );
  }
  if (!input.displayName.trim() || input.displayName.length > 64) {
    return fail(input.slug, 'failed', 'invalid-display-name', 'displayName must be 1-64 chars');
  }
  if (!input.description.trim() || input.description.length > 2048) {
    return fail(input.slug, 'failed', 'invalid-description', 'description must be 1-2048 chars');
  }

  // ── Phase 1: Scaffold ────────────────────────────────────────
  const destDir = resolve(homedir(), 'Cells', 'spinners', input.slug);
  if (existsSync(destDir)) {
    return fail(input.slug, 'failed', 'slug-in-use', `${destDir} already exists`);
  }

  // We import the Loom's scaffold function dynamically — Author runs
  // in the Loom's Node process so the module is resolvable. Anchor at
  // homedir() because process.cwd() under launchd may be elsewhere.
  // After build, the Loom serves from build/server/chunks/, not from
  // src/; use the same chunks via the workspace root path.
  const warpRoot = process.env['WARP_ROOT'] ?? join(homedir(), 'warp');
  const { scaffoldFromTemplate } = (await import(
    /* @vite-ignore */ `${warpRoot}/loom/src/lib/server/templates.ts`
  ).catch((e) => ({
    scaffoldFromTemplate: undefined,
    _err: String(e),
  }))) as typeof import('../../../loom/src/lib/server/templates.js') & { _err?: string };

  if (typeof scaffoldFromTemplate !== 'function') {
    return fail(
      input.slug,
      'failed',
      'loom-module-not-resolvable',
      `Cannot import templates from ${warpRoot}/loom/src/lib/server/templates.ts — Author must run in-process inside the Loom.`,
    );
  }

  // Authenticate against PB to derive the cell fingerprint + the
  // bearer for the install op.
  const pbEmail = process.env['WARP_PB_EMAIL'] ?? readBootstrap('pb-email');
  const pbPassword = process.env['WARP_PB_PASSWORD'] ?? readBootstrap('pb-password');
  if (!pbEmail || !pbPassword) {
    return fail(input.slug, 'failed', 'auth-failed', 'PB credentials missing on the Loom');
  }
  const authRes = await fetch(`${DEFAULT_PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: pbEmail, password: pbPassword }),
  });
  if (!authRes.ok) {
    return fail(
      input.slug,
      'failed',
      'auth-failed',
      `PB superuser auth: ${authRes.status} ${await authRes.text()}`,
    );
  }
  const authBody = (await authRes.json()) as {
    token: string;
    record: { email: string; id: string };
  };
  const pbToken = authBody.token;
  const actorEmail = authBody.record.email;
  // actorId unused since switching install to HTTP endpoint (the
  // endpoint derives actor from session.token internally).

  // Cell fingerprint (for the meta.json that the template embeds).
  let cellFingerprint = 'unknown';
  try {
    const identityRes = await fetch(
      `${DEFAULT_PB_URL}/api/collections/wp_cell_identity/records?perPage=1`,
      {
        headers: { Authorization: pbToken },
      },
    );
    if (identityRes.ok) {
      const idBody = (await identityRes.json()) as { items: { fingerprint: string }[] };
      if (idBody.items[0]) cellFingerprint = idBody.items[0].fingerprint;
    }
  } catch {
    // best effort; the scaffold doesn't require a real fingerprint
  }

  const scaffold = await scaffoldFromTemplate({
    templateName,
    destDir,
    vars: {
      slug: input.slug,
      name: `${scope}/${input.slug}`,
      displayName: input.displayName,
      description: input.description,
      authorEmail: actorEmail,
      cellFingerprint,
      createdAt: new Date().toISOString(),
    },
  });
  if (!scaffold.ok) {
    return fail(
      input.slug,
      'failed',
      scaffold.error.kind,
      'detail' in scaffold.error ? scaffold.error.detail : '',
    );
  }

  // ── Phase 2: Scenario-written ────────────────────────────────
  const scenarioSlug = `${input.slug}-install`;
  const scenarioPath = join(scenariosDir(), `${scenarioSlug}.json`);
  if (existsSync(scenarioPath)) {
    return fail(
      input.slug,
      'failed',
      'scenario-slug-in-use',
      `${scenarioPath} already exists — pick a different slug.`,
    );
  }
  const scenarioJson = buildInstallScenario(scenarioSlug, input.slug, input.displayName);
  writeFileSync(scenarioPath, JSON.stringify(scenarioJson, null, 2) + '\n', 'utf8');

  // ── Phase 3: Install ─────────────────────────────────────────
  // Call the Loom's /admin/spinners/install HTTP endpoint rather than
  // importing the module. Two reasons:
  //   1. spinner-install-op.ts chains relative `./identity.js`
  //      imports that don't resolve when loaded from outside the
  //      Loom workspace.
  //   2. Going through the HTTP surface means Author exercises the
  //      same audited path the Wizard would — Witness will see the
  //      install op + audit events in the same shape.
  const installRes = await fetch(`${DEFAULT_LOOM_BASE}/admin/spinners/install`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `wp_session=_superusers::${pbToken}`,
    },
    body: JSON.stringify({ bundlePath: destDir }),
  });
  if (!installRes.ok) {
    const text = await installRes.text();
    return fail(
      input.slug,
      'scenario-written',
      'install-http-failed',
      `POST /admin/spinners/install → ${installRes.status}: ${text.slice(0, 400)}`,
      scenarioSlug,
      destDir,
    );
  }
  const installBody = (await installRes.json()) as {
    ok: boolean;
    error?: { kind?: string; detail?: string };
  };
  if (!installBody.ok) {
    return fail(
      input.slug,
      'scenario-written',
      installBody.error?.kind ?? 'install-failed',
      installBody.error?.detail ?? JSON.stringify(installBody).slice(0, 400),
      scenarioSlug,
      destDir,
    );
  }

  // ── Phase 4: Verify (Witness) ────────────────────────────────
  const witnessRes = await fetch(`${DEFAULT_LOOM_BASE}/admin/spinners/witness/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // We need an authenticated cookie for the invoke endpoint.
      // Reuse our superuser PB token as a session cookie.
      Cookie: `wp_session=_superusers::${pbToken}`,
    },
    body: JSON.stringify({
      capability: 'verifyScenario',
      input: {
        scenarioSlug,
        // Deliberately omit cleanupSpinnerSlug — the Author-generated
        // scenario verifies an *existing* install (the one Author just
        // produced), it doesn't install again. Cleanup would wipe the
        // row we just created and the scenario's first verifier
        // (pb-row-exists wp_skein) would fail.
      },
    }),
  });
  if (!witnessRes.ok) {
    return fail(
      input.slug,
      'installed',
      'witness-call-failed',
      `Witness invoke: ${witnessRes.status} ${await witnessRes.text()}`,
      scenarioSlug,
      destDir,
      `${scope}/${input.slug}`,
    );
  }
  const witnessBody = (await witnessRes.json()) as {
    ok: boolean;
    output?: Record<string, unknown>;
  };
  const witnessReport = witnessBody.output ?? {};
  const witnessOk = witnessBody.ok === true && witnessReport['ok'] === true;

  if (!witnessOk) {
    return {
      ok: false,
      slug: input.slug,
      scenarioSlug,
      bundlePath: destDir,
      skeinName: `${scope}/${input.slug}`,
      phase: 'failed',
      witnessReport,
      errorKind: 'witness-failed',
      errorDetail: 'See witnessReport.escalation for the failing step + evidence.',
    };
  }

  // ── Phase 5: Critique (Pablo) ────────────────────────────────
  // Fetch the just-authored Spinner's rendered detail page and pass
  // it to Pablo for design-quality review. Pablo's verdict joins the
  // output. 'concerns' is non-fatal; only 'fails' flips ok→false.
  let pabloReport: Record<string, unknown> | undefined;
  let pabloVerdict: string | undefined;
  try {
    const detailRes = await fetch(`${DEFAULT_LOOM_BASE}/admin/spinners/${input.slug}`, {
      headers: { Cookie: `wp_session=_superusers::${pbToken}` },
    });
    if (detailRes.ok) {
      const html = await detailRes.text();
      const pabloRes = await fetch(`${DEFAULT_LOOM_BASE}/admin/spinners/pablo/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `wp_session=_superusers::${pbToken}`,
        },
        body: JSON.stringify({
          capability: 'review',
          input: {
            html,
            label: `${input.displayName} (just authored)`,
            topic:
              input.intent ??
              `Author scaffolded this Spinner from the hello-spinner template. Walk it as a Webspinner would see it after a successful authoring run.`,
          },
        }),
      });
      if (pabloRes.ok) {
        const pabloBody = (await pabloRes.json()) as {
          ok?: boolean;
          output?: Record<string, unknown>;
        };
        pabloReport = pabloBody.output;
        pabloVerdict =
          typeof pabloReport?.['verdict'] === 'string'
            ? (pabloReport['verdict'] as string)
            : undefined;
      } else {
        pabloReport = {
          _httpStatus: pabloRes.status,
          _body: (await pabloRes.text()).slice(0, 300),
        };
      }
    } else {
      pabloReport = { _detailFetchFailed: detailRes.status };
    }
  } catch (e) {
    pabloReport = { _error: e instanceof Error ? e.message : String(e) };
  }

  const pabloFails = pabloVerdict === 'fails';
  return {
    ok: !pabloFails,
    slug: input.slug,
    scenarioSlug,
    bundlePath: destDir,
    skeinName: `${scope}/${input.slug}`,
    phase: pabloFails ? 'failed' : 'critiqued',
    witnessReport,
    ...(pabloReport !== undefined ? { pabloReport } : {}),
    ...(pabloFails
      ? {
          errorKind: 'pablo-fails',
          errorDetail: 'Pablo verdict was "fails"; see pabloReport.findings.',
        }
      : {}),
  };
}

// ── helpers ──────────────────────────────────────────────────────

function buildInstallScenario(
  scenarioSlug: string,
  spinnerSlug: string,
  displayName: string,
): Record<string, unknown> {
  return {
    slug: scenarioSlug,
    title: `Installing ${displayName}`,
    summary: `The SI verifies the freshly-authored Spinner "${spinnerSlug}" is installed and invocable. Auto-generated by Author at the moment of authoring. Five steps: open the Skein, confirm the row, open the detail page, invoke greet, confirm the audit event.`,
    version: 2,
    fixtures: {
      slug: spinnerSlug,
      displayName,
    },
    steps: [
      {
        key: 'open-skein',
        title: 'Open the Skein',
        narration: `Navigating to the Skein. The freshly-authored "${displayName}" should appear with status verified.`,
        actions: [
          { kind: 'navigate-iframe', path: '/admin/spinners', waitForRoute: '/admin/spinners' },
          { kind: 'sleep', ms: 600 },
        ],
        verifications: [
          {
            kind: 'pb-row-exists',
            collection: 'wp_skein',
            filter: 'slug = "{{fixture.slug}}"',
            assertFields: { integrity_status: 'verified' },
          },
        ],
      },
      {
        key: 'open-detail',
        title: 'Open the detail page',
        narration:
          'Clicking through to the authored Spinner. Its capabilities are listed; integrity is recorded.',
        actions: [
          {
            kind: 'navigate-iframe',
            path: '/admin/spinners/{{fixture.slug}}',
            waitForRoute: '/admin/spinners/{{fixture.slug}}',
          },
          { kind: 'wait-for-selector', selector: 'section.invoke' },
        ],
        verifications: [
          {
            kind: 'route-status',
            path: '/admin/spinners/{{fixture.slug}}',
            expectStatus: 200,
            bodyContains: ['greet'],
          },
        ],
      },
      {
        key: 'invoke-greet',
        title: 'Invoke the greet capability',
        narration:
          'Typing { "name": "Author" } into the input. Clicking Run. The Weaver dispatches; greet returns a greeting; an invoke audit event lands.',
        actions: [
          {
            kind: 'fill',
            selector: 'section.invoke textarea',
            value: '{"name": "Author"}',
          },
          { kind: 'sleep', ms: 400 },
          { kind: 'click', selector: 'section.invoke button[type="submit"]' },
          {
            kind: 'wait-for-selector',
            selector: 'section.invoke .entry-result, section.invoke .result-error',
            timeoutMs: 12000,
          },
          { kind: 'sleep', ms: 600 },
        ],
        verifications: [{ kind: 'audit-event', eventType: 'wp.spinner.invoke', windowSec: 60 }],
      },
      {
        key: 'refresh-integrity',
        title: 'Refresh integrity',
        narration:
          'Clicking Refresh integrity. The Loom recomputes the digest and confirms the badge stays verified — the trust loop closes.',
        actions: [
          { kind: 'wait-for-selector', selector: '.refresh-btn' },
          { kind: 'click', selector: '.refresh-btn' },
          { kind: 'sleep', ms: 1500 },
        ],
        verifications: [
          { kind: 'audit-event', eventType: 'wp.spinner.integrity-checked', windowSec: 60 },
        ],
      },
    ],
  };
}

function fail(
  slug: string,
  phase: AuthorPhase,
  kind: string,
  detail: string,
  scenarioSlug?: string,
  bundlePath?: string,
  skeinName?: string,
): AuthorOutput {
  return {
    ok: false,
    slug,
    phase,
    ...(scenarioSlug ? { scenarioSlug } : {}),
    ...(bundlePath ? { bundlePath } : {}),
    ...(skeinName ? { skeinName } : {}),
    errorKind: kind,
    errorDetail: detail,
  };
}

export default { authorSpinner };
