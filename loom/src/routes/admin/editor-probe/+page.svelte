<script lang="ts">
  // Block-5 editor-probe — admin-only page that mounts WebbaseRuntime
  // in editable=true mode against a synthetic ScreensDraft. The page
  // exists so Playwright can drive rename / delete / add and so the
  // Wizard can eyeball the affordances before the Loom frontend (Block
  // 7) puts them in front of patrons.
  //
  // The page logs every onEdit emission to a window-level array
  // (window.__editorProbeChanges) so the test can assert against the
  // emitted screensDraft sequence. The Save button is suppressed in
  // edit mode — the renderer itself shows the "Edit mode — your
  // changes save automatically" hint.
  import WebbaseRuntime from '$lib/runtime/WebbaseRuntime.svelte';

  const fixture = {
    shortCode: 'probe-1',
    installToken: 'probe-token',
    version: 1,
    locked: false,
    appName: 'Editor Probe',
    domain: 'editor-probe.local',
    branding: { palette: 'paper' },
    // Intentionally NO entities — exercises the new editable=true path
    // where the form renders from screen field defs alone. The Block-7
    // forms-first frontend will mount the renderer this way: at
    // propose-time the patron sees screens but the Spinner hasn't
    // derived entities yet.
    entities: [],
    screensDraft: {
      screens: [
        {
          id: 'screen-note-add',
          kind: 'form',
          name: 'Add note',
          parentEntity: 'note',
          layout: {
            sections: [
              {
                label: 'Note',
                fields: [
                  { id: 'title', label: 'Title', kind: 'text', required: true },
                  { id: 'body', label: 'Body', kind: 'long-text' },
                  { id: 'when', label: 'When', kind: 'date' },
                ],
              },
            ],
          },
        },
      ],
      navigation: [{ label: 'Notes', primary: true, screens: ['screen-note-add'] }],
    },
  };

  let changeCount = $state(0);
  let lastDraft = $state<unknown>(null);

  function onEdit(next: Record<string, unknown>) {
    changeCount += 1;
    lastDraft = next;
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __editorProbeChanges?: unknown[] };
      w.__editorProbeChanges = (w.__editorProbeChanges ?? []).concat([next]);
    }
  }
</script>

<div class="probe-bar" data-testid="probe-bar">
  <strong>Editor probe</strong> — edits emitted:
  <span data-testid="change-count">{changeCount}</span>
</div>

<WebbaseRuntime data={fixture} editable {onEdit} />

<pre class="probe-state" data-testid="last-draft">{JSON.stringify(lastDraft, null, 2)}</pre>

<style>
  .probe-bar {
    position: sticky;
    top: 0;
    z-index: 50;
    padding: 0.4rem 0.8rem;
    background: #1a1d23;
    color: #d7c9a5;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    border-bottom: 1px solid #2a2f38;
  }
  .probe-state {
    margin: 1rem;
    padding: 0.6rem;
    background: #0f1116;
    color: #8aa6b8;
    font-size: 0.7rem;
    max-height: 200px;
    overflow: auto;
    border-radius: 6px;
  }
</style>
