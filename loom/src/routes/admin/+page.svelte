<script lang="ts">
  let { data } = $props();
</script>

<h1>Status</h1>
<p class="lede">Signed in as {data.user.email}.</p>

<section class="cards">
  <article>
    <h2>Cell roles</h2>
    <dl>
      <dt>Loom</dt>
      <dd>this app — SvelteKit (Node) on Kepler</dd>
      <dt>Weaver</dt>
      <dd>spec pending — bootstrap stand-up scheduled</dd>
      <dt>Grimoire</dt>
      <dd>PocketBase 0.38.0 (bootstrap)</dd>
    </dl>
  </article>

  <article>
    <h2>Reach</h2>
    <dl>
      <dt>LAN</dt>
      <dd>Kepler over the home network</dd>
      <dt>Tailnet</dt>
      <dd>Spindle ↔ Kepler when away</dd>
      <dt>Public</dt>
      <dd>None — bootstrap topology</dd>
    </dl>
  </article>

  <article>
    <h2>Federation</h2>
    <dl>
      <dt>Peers</dt>
      <dd>None — single-Cell bootstrap</dd>
      <dt>Capability Bus</dt>
      <dd>spec pending</dd>
      <dt>Public surface</dt>
      <dd>Deferred until summer 2026</dd>
    </dl>
  </article>
</section>

<p class="note">
  Bootstrap status placeholder. Live health checks, deployment history, audit-log activity, and BYOK
  spend wire in once the Weaver exposes a snapshot capability and the Grimoire holds the
  corresponding schemas.
</p>

<style>
  h1 {
    margin: 0 0 0.4rem;
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
    font-family: var(--font-prose);
  }

  .lede {
    margin: 0 0 2.25rem;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1.55;
    max-width: 60ch;
    font-family: var(--font-prose);
    font-style: italic;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    max-width: 64rem;
  }

  article {
    background: #111;
    border: 1px solid #1f1f1f;
    border-radius: 8px;
    padding: 1.4rem 1.65rem;
  }

  article h2 {
    margin: 0 0 1rem;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--cyan);
    font-weight: 600;
  }

  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.85rem 1.25rem;
    font-size: 0.92rem;
    line-height: 1.5;
  }

  dt {
    color: var(--gold-dim);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    padding-top: 0.18rem;
    font-family: var(--font-data);
  }

  dd {
    margin: 0;
    color: var(--text-secondary);
    font-family: var(--font-data);
  }

  .note {
    margin: 2.5rem 0 0;
    color: var(--text-secondary);
    font-size: 0.95rem;
    max-width: 60ch;
    line-height: 1.65;
    font-family: var(--font-prose);
    font-style: italic;
  }
</style>
