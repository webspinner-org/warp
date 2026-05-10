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
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
  }

  .lede {
    margin: 0 0 2rem;
    color: var(--text-mute);
    font-size: 0.9rem;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
    max-width: 64rem;
  }

  article {
    background: #111;
    border: 1px solid #1f1f1f;
    border-radius: 6px;
    padding: 1rem 1.25rem;
  }

  article h2 {
    margin: 0 0 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--cyan);
    font-weight: 600;
  }

  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 0.4rem 0.8rem;
    font-size: 0.85rem;
  }

  dt {
    color: var(--text-mute);
  }

  dd {
    margin: 0;
    color: #ddd;
  }

  .note {
    margin: 2rem 0 0;
    color: var(--text-mute);
    font-size: 0.85rem;
    max-width: 60ch;
    line-height: 1.6;
  }
</style>
