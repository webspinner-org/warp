<script lang="ts">
  // WebbaseRuntime — the universal in-browser renderer for a Webbase.
  //
  // Hosted at /run/<shortCode> in the demo Loom AND bundled standalone
  // (vite.standalone.config.ts → build/standalone/webbase-runtime.js).
  // Same component, same behaviour; the standalone build inlines this
  // component + its Svelte runtime into a single .html with the bundle
  // data already embedded as a JSON script tag — no Cell needed at
  // runtime.
  //
  // The `data` prop is shape-compatible with /run's PageServerLoad
  // output, so the page passes its server-loaded data through; the
  // standalone entry reads the inlined JSON and passes the same shape.
  import { onMount } from 'svelte';

  // Self-contained shape — no $types.js import so this component
  // compiles cleanly outside SvelteKit's build.
  interface WebbaseData {
    shortCode: string;
    installToken: string;
    version: number;
    locked: boolean;
    appName: string;
    domain: string;
    senderEmail?: string;
    expiresAt?: string;
    screensDraft?: Record<string, unknown> | null;
    entities?: readonly unknown[];
    branding?: unknown;
    // Block-11 — optional sample-records snapshot, present when the
    // patron published with "Include current sample data" checked.
    // Keyed by entity slug; each value is an array of plain field-
    // value objects (PB metadata stripped server-side).
    sampleRecords?: Record<string, readonly Record<string, unknown>[]> | null;
  }

  // editable: when true, render direct-edit affordances on each form
  // field (inline-rename label, remove field, add field). When false
  // (default), the component renders as the run-time it has always
  // been — no affordances, no edit hooks, zero visual change.
  //
  // onEdit: invoked on every direct edit with the FULL updated
  // screensDraft. The caller decides what to do (debounce + PATCH,
  // local cache, etc.). The renderer does not own persistence.
  //
  // Per loom-design.md §4.1 + §13 Q5: edits are color-coded by
  // impact (gray=cosmetic layout, gold=schema). For v2.0 we treat
  // every field-shape change as schema; layout-only ops (reorder)
  // ship in v2.0.1.
  let {
    data,
    editable = false,
    onEdit = undefined,
  }: {
    data: WebbaseData;
    editable?: boolean;
    onEdit?: (nextScreensDraft: Record<string, unknown>) => void;
  } = $props();

  // ─── Types ──────────────────────────────────────────────────
  interface EntityField {
    name: string;
    kind: string;
    describes?: string;
  }
  interface Entity {
    name: string;
    fields: EntityField[];
    links: { to: string }[];
  }
  interface ScreenField {
    id: string;
    label?: string;
    kind: string;
    required?: boolean;
    options?: string[];
    linkTo?: string;
    describes?: string;
  }
  interface Section {
    label?: string;
    fields: ScreenField[];
  }
  interface Screen {
    id: string;
    kind: 'form' | 'list' | 'detail' | string;
    name?: string;
    parentEntity?: string;
    describes?: string;
    layout?: {
      sections?: Section[];
      columns?: { fieldId: string }[];
      defaultSort?: { field: string; direction: 'asc' | 'desc' };
      showFields?: string[];
    };
  }
  interface NavGroup {
    label: string;
    primary?: boolean;
    screens: string[];
  }
  interface Record_ {
    id: string;
    _createdAt: string;
    _updatedAt: string;
    [key: string]: unknown;
  }

  // In editable mode the screensDraft is mutated in place; we keep a
  // live $state copy that backs both the renderer and the onEdit emit.
  // In read-only mode the same state is initialized once and never
  // changed — zero overhead vs the const-based runtime that shipped
  // before.
  let liveScreensDraft = $state<Record<string, unknown>>(
    JSON.parse(JSON.stringify((data.screensDraft ?? {}) as Record<string, unknown>)),
  );
  const entities = (data.entities ?? []) as Entity[];
  let screens = $derived((liveScreensDraft['screens'] ?? []) as Screen[]);
  let navigation = $derived((liveScreensDraft['navigation'] ?? []) as NavGroup[]);

  function emitChange() {
    if (!editable || !onEdit) return;
    // Hand the caller a plain object, not a Svelte reactive proxy.
    onEdit($state.snapshot(liveScreensDraft) as Record<string, unknown>);
  }

  // ─── Edit operations (deterministic, no LLM) ─────────────────
  // Each operation mutates liveScreensDraft in place AND triggers
  // reactivity by reassigning the screens array (Svelte 5's
  // shallow-tracking $state needs a top-level write to notice).

  function findFieldInDraft(
    fieldId: string,
  ): { screenIdx: number; sectionIdx: number; fieldIdx: number } | null {
    const scrs = (liveScreensDraft['screens'] ?? []) as Screen[];
    for (let si = 0; si < scrs.length; si++) {
      const s = scrs[si];
      if (s.kind !== 'form') continue;
      const sections = s.layout?.sections ?? [];
      for (let sx = 0; sx < sections.length; sx++) {
        const fields = sections[sx].fields ?? [];
        for (let fi = 0; fi < fields.length; fi++) {
          if (fields[fi].id === fieldId) return { screenIdx: si, sectionIdx: sx, fieldIdx: fi };
        }
      }
    }
    return null;
  }

  function renameField(fieldId: string, newLabel: string) {
    const loc = findFieldInDraft(fieldId);
    if (!loc) return;
    // $state.snapshot strips the Svelte 5 reactive proxy so structuredClone
    // works (proxies aren't cloneable).
    const next = structuredClone($state.snapshot(liveScreensDraft)) as Record<string, unknown>;
    const scrs = next['screens'] as Screen[];
    const fld = scrs[loc.screenIdx].layout!.sections![loc.sectionIdx].fields[loc.fieldIdx];
    if (fld.label === newLabel || newLabel.trim().length === 0) return;
    fld.label = newLabel.trim();
    liveScreensDraft = next;
    emitChange();
  }

  function removeField(fieldId: string) {
    const loc = findFieldInDraft(fieldId);
    if (!loc) return;
    // $state.snapshot strips the Svelte 5 reactive proxy so structuredClone
    // works (proxies aren't cloneable).
    const next = structuredClone($state.snapshot(liveScreensDraft)) as Record<string, unknown>;
    const scrs = next['screens'] as Screen[];
    scrs[loc.screenIdx].layout!.sections![loc.sectionIdx].fields.splice(loc.fieldIdx, 1);
    liveScreensDraft = next;
    emitChange();
  }

  function addField(screenId: string) {
    // $state.snapshot strips the Svelte 5 reactive proxy so structuredClone
    // works (proxies aren't cloneable).
    const next = structuredClone($state.snapshot(liveScreensDraft)) as Record<string, unknown>;
    const scrs = next['screens'] as Screen[];
    const screen = scrs.find((s) => s.id === screenId);
    if (!screen || screen.kind !== 'form') return;
    const sections = screen.layout?.sections;
    if (!sections || sections.length === 0) return;
    // Append to the last section. Default field is plain text with
    // a unique id; the patron renames it immediately.
    const newId = `field_${Date.now().toString(36)}`;
    sections[sections.length - 1].fields.push({
      id: newId,
      label: 'New field',
      kind: 'text',
    });
    liveScreensDraft = next;
    emitChange();
  }

  // ─── Unlock ──────────────────────────────────────────────────
  let unlocked = $state(!data.locked);
  let passphrase = $state('');
  let unlockError = $state<string | null>(null);
  let unlocking = $state(false);

  async function unlock() {
    if (!passphrase) return;
    unlocking = true;
    unlockError = null;
    const r = await fetch(`/app/${data.shortCode}/unlock?t=${data.installToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    const body = await r.json().catch(() => null);
    unlocking = false;
    if (r.ok && body?.ok) {
      unlocked = true;
      passphrase = '';
    } else {
      unlockError = body?.reason ?? `HTTP ${r.status}`;
    }
  }

  // ─── IndexedDB ───────────────────────────────────────────────
  // One DB per Webbase code; one object store per entity.
  const DB_NAME = `webbase-${data.shortCode}`;
  const DB_VERSION = 1;
  let dbRef = $state<IDBDatabase | null>(null);

  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const e of entities) {
          if (!db.objectStoreNames.contains(e.name)) {
            db.createObjectStore(e.name, { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  function listAll(entity: string): Promise<Record_[]> {
    return new Promise((resolve, reject) => {
      if (!dbRef) return reject(new Error('db-not-open'));
      const t = dbRef.transaction(entity, 'readonly');
      const req = t.objectStore(entity).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as Record_[]);
      req.onerror = () => reject(req.error);
    });
  }

  function putOne(entity: string, rec: Record_): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!dbRef) return reject(new Error('db-not-open'));
      const t = dbRef.transaction(entity, 'readwrite');
      const req = t.objectStore(entity).put(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function deleteOne(entity: string, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!dbRef) return reject(new Error('db-not-open'));
      const t = dbRef.transaction(entity, 'readwrite');
      const req = t.objectStore(entity).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ─── State ───────────────────────────────────────────────────
  let activeScreenId = $state<string>('');
  let records = $state<Record<string, Record_[]>>({}); // entityName → records
  let editing = $state<{ entity: string; record: Record_ | null } | null>(null);
  let savedFlash = $state<{ screenId: string; ts: number } | null>(null);

  let activeScreenVal = $derived(screens.find((s) => s.id === activeScreenId) ?? null);
  let activeEntityVal = $derived(
    activeScreenVal?.parentEntity
      ? (entities.find((e) => e.name === activeScreenVal!.parentEntity) ?? null)
      : null,
  );
  let activeFormFields = $derived(
    (activeScreenVal?.layout?.sections ?? []).flatMap((s) => s.fields),
  );
  let activeListColumns = $derived(activeScreenVal?.layout?.columns ?? []);
  let activeListRows = $derived(
    activeEntityVal && activeScreenVal
      ? sortRecords(records[activeEntityVal.name] ?? [], activeScreenVal, activeEntityVal)
      : [],
  );
  let activeFormScreenForEntity = $derived(
    activeEntityVal
      ? (screens.find((s) => s.kind === 'form' && s.parentEntity === activeEntityVal!.name) ?? null)
      : null,
  );

  $effect(() => {
    // Default screen: first list-kind in nav, else first screen.
    if (!activeScreenId && screens.length > 0) {
      const firstList = screens.find((s) => s.kind === 'list');
      activeScreenId = firstList?.id ?? screens[0]?.id ?? '';
    }
  });

  // Block-11 — populate banner state. Shown when the bundle ships
  // with `sampleRecords` AND IndexedDB is empty across every entity.
  // Hidden once the patron clicks Populate, dismisses, or any record
  // gets added (manually or via populate itself).
  let populateBannerVisible = $state(false);
  let populateInFlight = $state(false);
  let populateMsg = $state<string | null>(null);

  onMount(async () => {
    try {
      dbRef = await openDb();
      // Preload counts for nav.
      for (const e of entities) {
        records[e.name] = await listAll(e.name);
      }
      records = { ...records };
      // Block-11 — surface the populate banner if the bundle has
      // sample data AND every entity is currently empty in IDB.
      const hasSamples =
        data.sampleRecords &&
        typeof data.sampleRecords === 'object' &&
        Object.keys(data.sampleRecords).length > 0;
      const allEmpty = entities.every((e) => (records[e.name] ?? []).length === 0);
      populateBannerVisible = !!hasSamples && allEmpty;
    } catch (err) {
      console.error('IDB error', err);
    }
  });

  // Block-11 — write every bundled sample row into IndexedDB. Each
  // record gets a fresh id + timestamps so the runtime treats it like
  // any other patron-added row. Errors per record are tolerated:
  // we log + continue so a single malformed row doesn't strand the
  // whole set.
  async function populateFromBundle(): Promise<void> {
    if (populateInFlight) return;
    if (!data.sampleRecords) return;
    populateInFlight = true;
    populateMsg = 'Populating sample records…';
    try {
      const nowStr = nowIso();
      const samples = data.sampleRecords;
      let total = 0;
      let failed = 0;
      for (const e of entities) {
        // Lookup tolerates the schema using either the entity's name
        // or a lowercased / hyphen-stripped slug. The publish path
        // keys by entity.slug; schema.entities.name === slug in v0.
        const rows =
          (samples as Record<string, readonly Record<string, unknown>[]>)[e.name] ??
          (samples as Record<string, readonly Record<string, unknown>[]>)[e.name.toLowerCase()] ??
          (samples as Record<string, readonly Record<string, unknown>[]>)[
            e.name.replace(/-/g, '_').toLowerCase()
          ] ??
          [];
        for (const row of rows) {
          const id = uuid();
          const rec: Record_ = {
            id,
            _createdAt: nowStr,
            _updatedAt: nowStr,
            ...row,
          };
          try {
            await putOne(e.name, rec);
            total++;
          } catch (err) {
            failed++;
            console.warn('[populate] putOne failed', e.name, err);
          }
        }
        records[e.name] = await listAll(e.name);
      }
      records = { ...records };
      populateMsg =
        failed === 0
          ? `Populated ${total} record${total === 1 ? '' : 's'}.`
          : `Populated ${total} records — ${failed} skipped.`;
      // Auto-dismiss the banner after a brief confirmation flash.
      window.setTimeout(() => {
        populateBannerVisible = false;
        populateMsg = null;
      }, 1500);
    } catch (err) {
      populateMsg = 'Populate failed: ' + ((err as Error).message ?? String(err));
    } finally {
      populateInFlight = false;
    }
  }

  function dismissPopulateBanner() {
    populateBannerVisible = false;
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function uuid(): string {
    return crypto.randomUUID();
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  // Normalize screen-field id ↔ entity-field name (handles
  // `reconciliation-marker` vs `reconciliation_marker`).
  function normalize(id: string): string {
    return id.replace(/-/g, '_').toLowerCase();
  }

  function findEntityField(entity: Entity | null, fieldId: string): EntityField | null {
    if (!entity) return null;
    const want = normalize(fieldId);
    return entity.fields.find((f) => normalize(f.name) === want) ?? null;
  }

  function fieldLabel(sf: ScreenField, ef: EntityField | null): string {
    return sf.label || ef?.name || sf.id;
  }

  function formatValue(value: unknown, kind: string, entity?: string): string {
    if (value === null || value === undefined || value === '') return '—';
    if (kind === 'money' && typeof value === 'number') {
      return value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    }
    if (kind === 'date' && typeof value === 'string') {
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return value;
      }
    }
    if ((kind === 'link-to' || kind === 'linkTo') && entity && typeof value === 'string') {
      const related = (records[entity] ?? []).find((r) => r.id === value);
      const name =
        (related as { name?: unknown })?.name ??
        (related as { title?: unknown })?.title ??
        (related as { label?: unknown })?.label ??
        null;
      return typeof name === 'string' ? name : String(value).slice(0, 8);
    }
    return String(value);
  }

  async function saveRecord(form: HTMLFormElement, entity: Entity, screen: Screen) {
    const data: Record<string, unknown> = {};
    const fields = (screen.layout?.sections ?? []).flatMap((s) => s.fields);
    for (const f of fields) {
      const ef = findEntityField(entity, f.id);
      const name = ef?.name ?? normalize(f.id);
      const el = form.elements.namedItem(f.id) as HTMLInputElement | HTMLSelectElement | null;
      if (!el) continue;
      let value: unknown = el.value;
      if (f.kind === 'money' || f.kind === 'number') {
        value = value === '' ? null : Number(value);
      }
      if (f.kind === 'boolean' || f.kind === 'yes-no') {
        value = (el as HTMLInputElement).checked;
      }
      data[name] = value;
    }
    const id = editing?.record?.id ?? uuid();
    const existing = editing?.record;
    const rec: Record_ = {
      ...(existing ?? {}),
      ...data,
      id,
      _createdAt: existing?._createdAt ?? nowIso(),
      _updatedAt: nowIso(),
    };
    await putOne(entity.name, rec);
    records[entity.name] = await listAll(entity.name);
    records = { ...records };
    editing = null;
    savedFlash = { screenId: screen.id, ts: Date.now() };
    setTimeout(() => {
      if (savedFlash && Date.now() - savedFlash.ts > 1800) savedFlash = null;
    }, 2000);
  }

  async function removeRecord(entity: Entity, id: string) {
    if (!confirm('Delete this record?')) return;
    await deleteOne(entity.name, id);
    records[entity.name] = await listAll(entity.name);
    records = { ...records };
  }

  function fieldHtmlType(kind: string): string {
    switch (kind) {
      case 'money':
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      case 'email':
        return 'email';
      case 'url':
        return 'url';
      case 'tel':
      case 'phone':
        return 'tel';
      default:
        return 'text';
    }
  }

  function linkLabelOf(r: Record_): string {
    const candidate =
      (r as { name?: unknown }).name ??
      (r as { title?: unknown }).title ??
      (r as { label?: unknown }).label;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    return r.id.slice(0, 8);
  }

  function columnHeader(entity: Entity | null, fieldId: string): string {
    if (!entity) return fieldId;
    const ef = findEntityField(entity, fieldId);
    return ef?.name ?? fieldId;
  }

  function cellValue(entity: Entity | null, row: Record_, fieldId: string): string {
    if (!entity) return '';
    const ef = findEntityField(entity, fieldId);
    const key = ef?.name ?? normalize(fieldId);
    const val = (row as Record<string, unknown>)[key];
    // Entity field 'kind' often reads as plain 'text' even for
    // relations (the link sits in entity.links). Cross-reference
    // the screen field def to recover the link-to target.
    const linkTarget = findLinkTarget(entity, fieldId);
    const effectiveKind = linkTarget ? 'link-to' : (ef?.kind ?? 'text');
    return formatValue(val, effectiveKind, linkTarget);
  }

  function findLinkTarget(_entity: Entity, fieldId: string): string | undefined {
    // Cross-reference screen field defs to find the linkTo target
    // for a given field id (entity field metadata doesn't carry it).
    for (const s of screens) {
      const fields = (s.layout?.sections ?? []).flatMap((sec) => sec.fields);
      const m = fields.find((f) => normalize(f.id) === normalize(fieldId));
      if (m?.linkTo) return m.linkTo;
    }
    return undefined;
  }

  function sortRecords(rows: Record_[], screen: Screen, entity: Entity): Record_[] {
    const sort = screen.layout?.defaultSort;
    if (!sort) return rows;
    const ef = findEntityField(entity, sort.field);
    const key = ef?.name ?? normalize(sort.field);
    const dir = sort.direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[key];
      const bv = (b as Record<string, unknown>)[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (av as number | string) < (bv as number | string) ? -dir : dir;
    });
  }

  // Branding palette — pick the first option or fall back to defaults.
  const branding = data.branding as { options?: { palette: Record<string, string> }[] } | null;
  const palette = branding?.options?.[0]?.palette ?? {
    bg: '#15151a',
    surface: '#1c1c22',
    surfaceAlt: '#23232b',
    border: '#34373d',
    text: '#f0e9d8',
    textMuted: '#9a9189',
    accent: '#d4a574',
    accentSoft: '#e6c486',
  };

  let cssVars = $derived(
    `--bg:${palette.bg};--surface:${palette.surface};--surface-alt:${palette.surfaceAlt};` +
      `--border:${palette.border};--text:${palette.text};--muted:${palette.textMuted};` +
      `--accent:${palette.accent};--accent-soft:${palette.accentSoft};`,
  );
</script>

<svelte:head>
  <title>{data.appName}</title>
</svelte:head>

<div class="run-shell" style={cssVars}>
  {#if !unlocked}
    <section class="unlock-shell">
      <header>
        <h1>{data.appName}</h1>
        <p>This Webbase is locked. Enter the passphrase the author shared with you.</p>
      </header>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          unlock();
        }}
      >
        <input
          type="password"
          bind:value={passphrase}
          placeholder="Passphrase"
          autocomplete="off"
        />
        <button type="submit" disabled={unlocking || !passphrase}>
          {unlocking ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      {#if unlockError}<p class="error">{unlockError}</p>{/if}
    </section>
  {:else}
    <header class="topbar">
      <div class="topbar-l">
        <strong>{data.appName}</strong>
        <span class="domain">{data.domain}</span>
        <span class="version">v{data.version}</span>
      </div>
      <div class="topbar-r">
        <span class="hint">runs entirely in your browser · data stays here</span>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a class="link" href={`/app/${data.shortCode}?t=${data.installToken}`}>about</a>
      </div>
    </header>

    <div class="layout">
      <nav class="sidenav">
        {#each navigation as group (group.label)}
          <div class="nav-group">
            <h3>{group.label}</h3>
            <ul>
              {#each group.screens as sid (sid)}
                {@const s = screens.find((x) => x.id === sid)}
                {#if s}
                  <li>
                    <button
                      class:active={activeScreenId === sid}
                      onclick={() => {
                        activeScreenId = sid;
                        editing = null;
                      }}
                    >
                      {s.name ?? s.id}
                    </button>
                  </li>
                {/if}
              {/each}
            </ul>
          </div>
        {/each}
        {#if navigation.length === 0}
          <ul class="flat-nav">
            {#each screens as s (s.id)}
              <li>
                <button
                  class:active={activeScreenId === s.id}
                  onclick={() => {
                    activeScreenId = s.id;
                    editing = null;
                  }}
                >
                  {s.name ?? s.id}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </nav>

      <main class="content">
        {#if populateBannerVisible}
          <!-- Block-11 — first-open populate banner. Visible when the
               bundle shipped with sampleRecords and IndexedDB is
               empty. Click "Populate" to load the bundled rows; click
               × to dismiss without populating. -->
          <aside
            class="populate-banner"
            role="status"
            aria-live="polite"
            data-testid="populate-banner"
          >
            <div class="populate-banner-body">
              <strong>This Webbase came with sample data.</strong>
              <span>Populate your copy so you can see how it works.</span>
            </div>
            <div class="populate-banner-actions">
              <button
                type="button"
                class="populate-banner-go"
                data-testid="populate-banner-go"
                disabled={populateInFlight}
                onclick={() => populateFromBundle()}
              >
                {populateInFlight ? 'Populating…' : 'Populate'}
              </button>
              <button
                type="button"
                class="populate-banner-dismiss"
                aria-label="Dismiss"
                onclick={dismissPopulateBanner}>×</button
              >
            </div>
            {#if populateMsg}
              <p class="populate-banner-msg">{populateMsg}</p>
            {/if}
          </aside>
        {/if}
        {#if !activeScreenVal}
          <p class="empty">Pick a screen from the left.</p>
        {:else if activeScreenVal.kind === 'form'}
          <header class="screen-head">
            <h2>{activeScreenVal.name ?? activeScreenVal.id}</h2>
            {#if activeScreenVal.describes}<p>{activeScreenVal.describes}</p>{/if}
          </header>
          {#if !activeEntityVal && !editable}
            <p class="empty">No entity bound to this form.</p>
          {:else}
            <form
              class="form-card"
              onsubmit={(e) => {
                e.preventDefault();
                if (activeEntityVal && activeScreenVal) {
                  saveRecord(e.currentTarget as HTMLFormElement, activeEntityVal, activeScreenVal);
                }
              }}
            >
              {#each activeFormFields as f (f.id)}
                <label class="field" class:field--editable={editable}>
                  <span class="field-label">
                    {#if editable}
                      <input
                        class="field-label-input"
                        type="text"
                        value={fieldLabel(f, findEntityField(activeEntityVal, f.id))}
                        onblur={(e) =>
                          renameField(f.id, (e.currentTarget as HTMLInputElement).value)}
                        onkeydown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="field-del"
                        title="Remove this field"
                        aria-label="Remove this field"
                        onclick={(e) => {
                          e.preventDefault();
                          removeField(f.id);
                        }}>×</button
                      >
                    {:else}
                      {fieldLabel(f, findEntityField(activeEntityVal, f.id))}
                      {#if f.required}<em class="req">·</em>{/if}
                    {/if}
                  </span>
                  {#if f.kind === 'choice'}
                    <select name={f.id} required={f.required}>
                      <option value="">—</option>
                      {#each f.options ?? [] as opt (opt)}
                        <option value={opt}>{opt}</option>
                      {/each}
                    </select>
                  {:else if f.kind === 'link-to' || f.kind === 'linkTo'}
                    <select name={f.id} required={f.required}>
                      <option value="">—</option>
                      {#each records[f.linkTo ?? ''] ?? [] as r (r.id)}
                        <option value={r.id}>{linkLabelOf(r)}</option>
                      {/each}
                    </select>
                  {:else if f.kind === 'boolean' || f.kind === 'yes-no'}
                    <input type="checkbox" name={f.id} />
                  {:else if f.kind === 'textarea' || f.kind === 'notes'}
                    <textarea name={f.id} required={f.required} rows="3"></textarea>
                  {:else}
                    <input
                      type={fieldHtmlType(f.kind)}
                      name={f.id}
                      step={f.kind === 'money' ? '0.01' : undefined}
                      required={f.required}
                    />
                  {/if}
                  {#if f.describes}<small class="field-hint">{f.describes}</small>{/if}
                </label>
              {/each}
              {#if editable && activeScreenVal}
                <button
                  type="button"
                  class="field-add"
                  onclick={() => addField(activeScreenVal!.id)}>+ Add field</button
                >
              {/if}
              <div class="form-actions">
                {#if editable}
                  <span class="edit-mode-hint">Edit mode — your changes save automatically.</span>
                {:else}
                  <button type="submit" class="btn-primary">Save</button>
                {/if}
              </div>
              {#if savedFlash?.screenId === activeScreenVal.id}
                <p class="saved">Saved.</p>
              {/if}
            </form>
          {/if}
        {:else if activeScreenVal.kind === 'list'}
          <header class="screen-head row">
            <div>
              <h2>{activeScreenVal.name ?? activeScreenVal.id}</h2>
              {#if activeScreenVal.describes}<p>{activeScreenVal.describes}</p>{/if}
            </div>
            {#if activeEntityVal && activeFormScreenForEntity}
              <button
                class="btn-primary"
                onclick={() => {
                  if (activeFormScreenForEntity) activeScreenId = activeFormScreenForEntity.id;
                }}
              >
                + Add {activeEntityVal.name}
              </button>
            {/if}
          </header>
          {#if !activeEntityVal}
            <p class="empty">No entity bound to this list.</p>
          {:else if activeListRows.length === 0}
            <div class="empty-state">
              <h3>No records yet</h3>
              {#if activeScreenVal.describes}<p>{activeScreenVal.describes}</p>{/if}
              {#if activeFormScreenForEntity}
                <button
                  class="btn-primary"
                  onclick={() => {
                    if (activeFormScreenForEntity) activeScreenId = activeFormScreenForEntity.id;
                  }}
                >
                  Add the first one
                </button>
              {/if}
            </div>
          {:else}
            <table class="list-table">
              <thead>
                <tr>
                  {#each activeListColumns as col (col.fieldId)}
                    <th>{columnHeader(activeEntityVal, col.fieldId)}</th>
                  {/each}
                  <th class="actions-col"></th>
                </tr>
              </thead>
              <tbody>
                {#each activeListRows as row (row.id)}
                  <tr>
                    {#each activeListColumns as col (col.fieldId)}
                      <td>{cellValue(activeEntityVal, row, col.fieldId)}</td>
                    {/each}
                    <td class="actions-col">
                      <button
                        class="row-del"
                        title="Delete"
                        onclick={() => {
                          if (activeEntityVal) removeRecord(activeEntityVal, row.id);
                        }}>×</button
                      >
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {:else if activeScreenVal.kind === 'detail'}
          <header class="screen-head">
            <h2>{activeScreenVal.name ?? activeScreenVal.id}</h2>
          </header>
          <p class="empty">Detail views show one record at a time — pick one from the list.</p>
        {:else}
          <p class="empty">Screen kind "{activeScreenVal.kind}" is not rendered yet.</p>
        {/if}
      </main>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    background: var(--bg, #15151a);
  }
  .run-shell {
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, sans-serif;
  }

  /* Unlock */
  .unlock-shell {
    max-width: 420px;
    margin: 6rem auto;
    padding: 2rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .unlock-shell h1 {
    font-family: serif;
    margin: 0 0 0.4rem;
    color: var(--text);
  }
  .unlock-shell p {
    color: var(--muted);
    margin: 0 0 1.2rem;
  }
  .unlock-shell form {
    display: flex;
    gap: 0.5rem;
  }
  .unlock-shell input {
    flex: 1;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
    font-size: 1rem;
  }
  .unlock-shell button {
    background: linear-gradient(135deg, var(--accent), var(--accent-soft));
    color: var(--bg);
    border: 0;
    border-radius: 6px;
    padding: 0.5rem 1.1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .error {
    color: #f0c1c1;
    margin-top: 0.7rem;
    font-size: 0.88rem;
  }

  /* Topbar */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 1.2rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .topbar-l {
    display: flex;
    align-items: baseline;
    gap: 0.8rem;
  }
  .topbar-l strong {
    font-family: serif;
    color: var(--text);
    font-size: 1.15rem;
  }
  .domain,
  .version {
    color: var(--muted);
    font-size: 0.8rem;
    font-family: ui-monospace, monospace;
  }
  .topbar-r {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .hint {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .link {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.85rem;
  }
  .link:hover {
    text-decoration: underline;
  }

  /* Layout */
  .layout {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: calc(100vh - 50px);
  }
  .sidenav {
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 1rem 0.6rem;
    overflow-y: auto;
  }
  .nav-group + .nav-group {
    margin-top: 1.1rem;
  }
  .nav-group h3 {
    margin: 0 0 0.4rem;
    padding: 0 0.6rem;
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    font-family: ui-monospace, monospace;
  }
  .sidenav ul,
  .flat-nav {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sidenav li {
    margin: 0;
  }
  .sidenav button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 5px;
    color: var(--text);
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    font-size: 0.92rem;
  }
  .sidenav button:hover {
    background: var(--surface-alt);
  }
  .sidenav button.active {
    background: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }

  /* Content */
  .content {
    padding: 1.4rem 1.6rem;
    overflow-x: auto;
  }
  .screen-head h2 {
    font-family: serif;
    margin: 0 0 0.3rem;
    color: var(--text);
    font-size: 1.45rem;
  }
  .screen-head p {
    margin: 0 0 1rem;
    color: var(--muted);
  }
  .screen-head.row {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
  }

  /* Form */
  .form-card {
    max-width: 560px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.1rem 1.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .field-label {
    font-size: 0.78rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    font-family: ui-monospace, monospace;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .field-label .req {
    color: var(--accent);
    font-style: normal;
  }
  /* ── Editor affordances (only when editable=true) ────────────── */
  .field--editable {
    position: relative;
    padding: 0.25rem 0.4rem;
    border: 1px dashed transparent;
    border-radius: 6px;
    margin: 0 -0.4rem;
    transition: border-color 100ms ease;
  }
  .field--editable:hover,
  .field--editable:focus-within {
    border-color: var(--accent);
  }
  .field-label-input {
    flex: 1 1 auto;
    appearance: none;
    background: transparent;
    color: var(--muted);
    border: 0;
    border-bottom: 1px solid transparent;
    font: inherit;
    font-size: 0.78rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.1rem 0;
    min-width: 4rem;
  }
  .field-label-input:hover,
  .field-label-input:focus {
    outline: none;
    border-bottom-color: var(--accent);
    color: var(--accent);
  }
  .field-del {
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
    font-size: 1.05rem;
    line-height: 1;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .field--editable:hover .field-del,
  .field--editable:focus-within .field-del {
    opacity: 1;
  }
  .field-del:hover {
    background: color-mix(in oklab, #c33 18%, transparent);
    border-color: #c33;
    color: #f4a8a8;
  }
  .field-add {
    align-self: flex-start;
    appearance: none;
    background: transparent;
    color: var(--accent);
    border: 1px dashed var(--accent);
    border-radius: 6px;
    padding: 0.45rem 0.8rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    margin-top: 0.3rem;
  }
  .field-add:hover {
    background: color-mix(in oklab, var(--accent) 12%, transparent);
  }
  .edit-mode-hint {
    color: var(--muted);
    font-size: 0.78rem;
    font-style: italic;
  }
  .field input,
  .field select,
  .field textarea {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.45rem 0.65rem;
    font-size: 0.95rem;
    font-family: inherit;
  }
  .field input[type='checkbox'] {
    width: auto;
    align-self: flex-start;
  }
  .field input:focus,
  .field select:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .field-hint {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.4rem;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-soft));
    color: var(--bg);
    border: 0;
    border-radius: 6px;
    padding: 0.5rem 1.1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .saved {
    color: #b3d8b3;
    margin: 0;
    font-size: 0.88rem;
  }

  /* List */
  .list-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .list-table th,
  .list-table td {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-size: 0.92rem;
  }
  .list-table th {
    background: var(--surface-alt);
    color: var(--muted);
    font-size: 0.74rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-family: ui-monospace, monospace;
  }
  .list-table tr:last-child td {
    border-bottom: 0;
  }
  .actions-col {
    width: 2.4rem;
    text-align: right;
  }
  .row-del {
    background: transparent;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0 0.4rem;
  }
  .row-del:hover {
    color: #f0a0a0;
  }
  .empty {
    color: var(--muted);
  }
  /* Block-11 — populate-on-first-open banner. */
  .populate-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.7rem 0.95rem;
    margin: 0 0 0.85rem;
    background: var(--surface);
    border: 1px solid var(--accent, var(--border));
    border-left: 3px solid var(--accent, var(--text));
    border-radius: 8px;
    color: var(--text);
    font-size: 0.92rem;
    line-height: 1.4;
  }
  .populate-banner-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 12rem;
  }
  .populate-banner-body strong {
    font-weight: 600;
  }
  .populate-banner-body span {
    color: var(--muted);
    font-size: 0.86rem;
  }
  .populate-banner-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 0 auto;
  }
  .populate-banner-go {
    appearance: none;
    background: var(--accent, var(--text));
    color: var(--bg);
    border: 0;
    border-radius: 6px;
    padding: 0.45rem 0.85rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .populate-banner-go:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .populate-banner-go:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .populate-banner-dismiss {
    appearance: none;
    background: transparent;
    color: var(--muted);
    border: 1px solid transparent;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 5px;
    font-size: 1.05rem;
    cursor: pointer;
  }
  .populate-banner-dismiss:hover {
    background: color-mix(in oklab, var(--muted) 14%, transparent);
    color: var(--text);
  }
  .populate-banner-msg {
    flex: 1 0 100%;
    margin: 0;
    color: var(--muted);
    font-size: 0.84rem;
  }
  .empty-state {
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: 10px;
    padding: 2rem;
    text-align: center;
  }
  .empty-state h3 {
    margin: 0 0 0.4rem;
    color: var(--text);
    font-family: serif;
  }
  .empty-state p {
    color: var(--muted);
    margin: 0 0 1.1rem;
  }
</style>
