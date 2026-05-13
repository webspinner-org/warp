/**
 * Tests for the /admin/spinners/new author action. Exercises the
 * validation path (field-level errors) + the orchestration path
 * (scaffold → install). The underlying machinery (scaffoldFromTemplate
 * + installSpinnerBundle) is independently tested; these tests confirm
 * the action wires them together correctly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { rm, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { actions } from './+page.server.js';

const HELLO_SPINNER_DIR = resolve(homedir(), 'warp/templates/hello-spinner');
const CELLS_SPINNERS = resolve(homedir(), 'Cells/spinners');
const TEST_MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

async function templatesExist(): Promise<boolean> {
  try {
    return (await stat(HELLO_SPINNER_DIR)).isDirectory();
  } catch {
    return false;
  }
}

const createdBundles: string[] = [];

// loomPbToken reads these env vars; satisfying them is a precondition
// for tests that exercise the action past field validation.
const SAVED_ENV = {
  email: process.env['WARP_PB_EMAIL'],
  password: process.env['WARP_PB_PASSWORD'],
  masterKey: process.env['WARP_VAULT_MASTER_KEY'],
};

function setEnv(opts: { withMasterKey?: boolean } = {}) {
  process.env['WARP_PB_EMAIL'] = 'wiz@test';
  process.env['WARP_PB_PASSWORD'] = 'pwd';
  if (opts.withMasterKey) {
    process.env['WARP_VAULT_MASTER_KEY'] = TEST_MASTER_KEY;
  } else {
    delete process.env['WARP_VAULT_MASTER_KEY'];
  }
}

afterEach(async () => {
  // Clean up any bundles created in ~/Cells/spinners/ by tests.
  for (const slug of createdBundles.splice(0)) {
    try {
      await rm(resolve(CELLS_SPINNERS, slug), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  // Restore env.
  if (SAVED_ENV.email !== undefined) process.env['WARP_PB_EMAIL'] = SAVED_ENV.email;
  else delete process.env['WARP_PB_EMAIL'];
  if (SAVED_ENV.password !== undefined) process.env['WARP_PB_PASSWORD'] = SAVED_ENV.password;
  else delete process.env['WARP_PB_PASSWORD'];
  if (SAVED_ENV.masterKey !== undefined) process.env['WARP_VAULT_MASTER_KEY'] = SAVED_ENV.masterKey;
  else delete process.env['WARP_VAULT_MASTER_KEY'];
});

interface PbState {
  identityCollection: boolean;
  identityRows: Record<string, unknown>[];
  vaultRows: { id: string; name: string; ciphertext: string; iv: string }[];
  operationsCollection: boolean;
  operationsRows: Record<string, unknown>[];
  auditCollection: boolean;
  auditRows: Record<string, unknown>[];
  skeinCollection: boolean;
  skeinRows: Record<string, unknown>[];
}

function pbMock(seedSkein: Record<string, unknown>[] = []): {
  fetch: typeof fetch;
  state: PbState;
} {
  const state: PbState = {
    identityCollection: false,
    identityRows: [],
    vaultRows: [],
    operationsCollection: false,
    operationsRows: [],
    auditCollection: false,
    auditRows: [],
    skeinCollection: false,
    skeinRows: [...seedSkein],
  };
  let nextId = 1;
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const notFound = () => new Response('{"code":404}', { status: 404 });

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const u = new URL(url);
    const path = u.pathname;
    const search = u.search;

    if (
      path === '/api/admins/auth-refresh' ||
      path === '/api/collections/_superusers/auth-refresh'
    ) {
      return ok({
        token: 'tok',
        record: { id: 'wiz-id', email: 'wiz@test', created: '', updated: '' },
      });
    }
    if (path === '/api/collections/_superusers/auth-with-password') {
      return ok({
        token: 'tok',
        record: { id: 'wiz-id', email: 'wiz@test', created: '', updated: '' },
      });
    }

    // Generic ensure-collection probes.
    if (method === 'GET') {
      if (path === '/api/collections/wp_cell_identity') {
        return state.identityCollection ? ok({ name: 'wp_cell_identity' }) : notFound();
      }
      if (path === '/api/collections/wp_operations') {
        return state.operationsCollection ? ok({ name: 'wp_operations' }) : notFound();
      }
      if (path === '/api/collections/wp_audit') {
        return state.auditCollection ? ok({ name: 'wp_audit' }) : notFound();
      }
      if (path === '/api/collections/wp_skein') {
        return state.skeinCollection ? ok({ name: 'wp_skein' }) : notFound();
      }
    }
    if (path === '/api/collections' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { name: string };
      if (body.name === 'wp_cell_identity') state.identityCollection = true;
      if (body.name === 'wp_operations') state.operationsCollection = true;
      if (body.name === 'wp_audit') state.auditCollection = true;
      if (body.name === 'wp_skein') state.skeinCollection = true;
      return ok({ name: body.name });
    }

    // Records: identity
    if (path === '/api/collections/wp_cell_identity/records' && method === 'GET') {
      return ok({ items: state.identityRows.slice(0, 1) });
    }
    if (path === '/api/collections/wp_cell_identity/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.identityRows.push(row);
      return ok(row);
    }
    // Records: vault
    if (path === '/api/collections/vault_secrets/records' && method === 'GET') {
      const m =
        /filter=name%20%3D%20%22([^%]+)%22/.exec(search) ??
        /filter=name%20%3D%20"([^"]+)"/.exec(search);
      const filtered = m ? state.vaultRows.filter((r) => r.name === m[1]) : state.vaultRows;
      return ok({ items: filtered });
    }
    if (path === '/api/collections/vault_secrets/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as {
        name: string;
        ciphertext: string;
        iv: string;
      };
      const row = {
        id: `id-${nextId++}`,
        name: body.name,
        ciphertext: body.ciphertext,
        iv: body.iv,
      };
      state.vaultRows.push(row);
      return ok(row);
    }
    // Records: operations
    if (path === '/api/collections/wp_operations/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.operationsRows.push(row);
      return ok(row);
    }
    // Records: audit
    if (path === '/api/collections/wp_audit/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.auditRows.push(row);
      return ok(row);
    }
    // Records: skein
    if (path === '/api/collections/wp_skein/records' && method === 'GET') {
      const filter = new URLSearchParams(search).get('filter') ?? '';
      let rows = [...state.skeinRows];
      const slugMatch = /slug = "([^"]+)"/.exec(filter);
      if (slugMatch) rows = rows.filter((r) => r['slug'] === slugMatch[1]);
      rows.sort((a, b) =>
        String(b['installed_at'] ?? '').localeCompare(String(a['installed_at'] ?? '')),
      );
      return ok({ items: rows });
    }
    if (path === '/api/collections/wp_skein/records' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const row = { id: `id-${nextId++}`, ...body };
      state.skeinRows.push(row);
      return ok(row);
    }
    return notFound();
  }) as typeof fetch;
  return { fetch: fetchFn, state };
}

function mockCookies(token = 'tok'): {
  get(name: string): string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set?(...args: any[]): void;
} {
  return {
    get(name: string) {
      if (name === 'wp_session') return `_superusers::${token}`;
      return undefined;
    },
  };
}

async function callAuthor(
  fields: Record<string, string>,
  options: { pb: { fetch: typeof fetch }; cookies?: ReturnType<typeof mockCookies> },
) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(fields)) formData.append(k, v);
  const request = new Request('http://test/admin/spinners/new?/author', {
    method: 'POST',
    body: formData,
  });
  // SvelteKit's action signature expects RequestEvent — we synthesize
  // the slots the action reads. Cast through unknown to satisfy TS.
  const event = {
    request,
    fetch: options.pb.fetch,
    cookies: options.cookies ?? mockCookies(),
  } as unknown as Parameters<typeof actions.author>[0];
  return actions.author!(event);
}

describe('/admin/spinners/new — author action', async () => {
  const hasTemplates = await templatesExist();

  it('returns 400 when slug is empty', async () => {
    const pb = pbMock();
    const result = await callAuthor(
      {
        template: 'hello-spinner',
        slug: '',
        displayName: 'Test',
        description: 'A test.',
        scope: '@local',
      },
      { pb },
    );
    expect(result?.status).toBe(400);
    if (result?.status === 400) {
      const data = result.data as { errors: { slug?: string } };
      expect(data.errors.slug).toBeTruthy();
    }
  });

  it('returns 400 when slug has invalid pattern', async () => {
    const pb = pbMock();
    const result = await callAuthor(
      {
        template: 'hello-spinner',
        slug: 'Has Capital Letters',
        displayName: 'Test',
        description: 'A test.',
        scope: '@local',
      },
      { pb },
    );
    expect(result?.status).toBe(400);
    if (result?.status === 400) {
      const data = result.data as { errors: { slug?: string } };
      expect(data.errors.slug).toContain('lowercase');
    }
  });

  it('returns 400 when displayName is empty', async () => {
    const pb = pbMock();
    const result = await callAuthor(
      {
        template: 'hello-spinner',
        slug: 'test-empty-dn',
        displayName: '',
        description: 'A test.',
        scope: '@local',
      },
      { pb },
    );
    expect(result?.status).toBe(400);
    if (result?.status === 400) {
      const data = result.data as { errors: { displayName?: string } };
      expect(data.errors.displayName).toBeTruthy();
    }
  });

  it('returns 400 when description is empty', async () => {
    const pb = pbMock();
    const result = await callAuthor(
      {
        template: 'hello-spinner',
        slug: 'test-empty-desc',
        displayName: 'Test',
        description: '',
        scope: '@local',
      },
      { pb },
    );
    expect(result?.status).toBe(400);
    if (result?.status === 400) {
      const data = result.data as { errors: { description?: string } };
      expect(data.errors.description).toBeTruthy();
    }
  });

  it('returns 400 when scope is invalid', async () => {
    const pb = pbMock();
    const result = await callAuthor(
      {
        template: 'hello-spinner',
        slug: 'test-bad-scope',
        displayName: 'Test',
        description: 'A test.',
        scope: 'not-an-at-scope',
      },
      { pb },
    );
    expect(result?.status).toBe(400);
    if (result?.status === 400) {
      const data = result.data as { errors: { scope?: string } };
      expect(data.errors.scope).toBeTruthy();
    }
  });

  it.skipIf(!hasTemplates)('returns 400 when template is unknown', async () => {
    const pb = pbMock();
    const result = await callAuthor(
      {
        template: 'does-not-exist',
        slug: 'test-bad-template',
        displayName: 'Test',
        description: 'A test.',
        scope: '@local',
      },
      { pb },
    );
    expect(result?.status).toBe(400);
    if (result?.status === 400) {
      const data = result.data as { errors: { template?: string } };
      expect(data.errors.template).toContain('not found');
    }
  });

  it.skipIf(!hasTemplates)('returns 400 when slug already in skein', async () => {
    setEnv();
    const pb = pbMock([
      {
        id: 'existing-1',
        slug: 'test-already-installed',
        name: '@local/test-already-installed',
        version: '1.0.0',
        bundle_path: '/some/path',
        source: 'cell-authored',
        recorded_digest: 'sha256:00',
        signers: [],
        integrity_status: 'verified',
        last_integrity_check: '2026-05-12T17:00:00.000Z',
        installed_at: '2026-05-12T17:00:00.000Z',
        installed_by: 'wiz',
      },
    ]);
    const result = await callAuthor(
      {
        template: 'hello-spinner',
        slug: 'test-already-installed',
        displayName: 'Test',
        description: 'A test.',
        scope: '@local',
      },
      { pb },
    );
    expect(result?.status).toBe(400);
    if (result?.status === 400) {
      const data = result.data as { errors: { slug?: string } };
      expect(data.errors.slug).toContain('already installed');
    }
  });

  it('returns 500 when WARP_VAULT_MASTER_KEY missing', async () => {
    setEnv({ withMasterKey: false });
    const pb = pbMock();
    const result = await callAuthor(
      {
        template: 'hello-spinner',
        slug: 'test-no-master-key',
        displayName: 'Test',
        description: 'A test.',
        scope: '@local',
      },
      { pb },
    );
    // If templates not present, the request shortcuts to template-not-found 400.
    if (!(await templatesExist())) return;
    expect(result?.status).toBe(500);
    if (result?.status === 500) {
      const data = result.data as { topLevelError?: { kind: string } };
      // Either the master-key check fires before scaffold runs, OR install fails
      // first; both surface a topLevelError.
      expect(data.topLevelError?.kind).toBeTruthy();
    }
  });

  it.skipIf(!hasTemplates)(
    'happy path: scaffolds + installs and throws a redirect to /admin/spinners/<slug>',
    async () => {
      setEnv({ withMasterKey: true });
      const pb = pbMock();
      const slug = 'test-happy-' + Date.now().toString(36);
      createdBundles.push(slug);
      let redirectThrown: unknown;
      try {
        await callAuthor(
          {
            template: 'hello-spinner',
            slug,
            displayName: 'Test Happy',
            description: 'A test of the happy path.',
            scope: '@local',
          },
          { pb },
        );
      } catch (e) {
        redirectThrown = e;
      }
      // SvelteKit redirect() throws an object with status + location.
      expect(redirectThrown).toBeTruthy();
      const r = redirectThrown as { status?: number; location?: string };
      expect(r.status).toBe(303);
      expect(r.location).toBe(`/admin/spinners/${slug}`);

      // The scaffolded bundle exists on disk + wp_skein row was written.
      const destDir = resolve(CELLS_SPINNERS, slug);
      const entries = await readdir(destDir);
      expect(entries).toContain('manifest.json');
      expect(entries).toContain('provenance');
      expect(pb.state.skeinRows.length).toBe(1);
      expect(pb.state.skeinRows[0]?.['slug']).toBe(slug);
    },
  );
});
