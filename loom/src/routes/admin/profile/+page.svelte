<script lang="ts">
  let { data } = $props();
</script>

<h1>Profile</h1>
<dl>
  <dt>Email</dt>
  <dd>{data.user.email}</dd>
  <dt>Superuser ID</dt>
  <dd>{data.user.id}</dd>
</dl>

<p class="placeholder">
  Wizard profile — name, locale, MFA enrolment, session revocation, Cell identity key — fills out
  as the architecture extends.
</p>

<style>
  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
  }

  dl {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: 0.5rem 1rem;
    margin: 1.5rem 0 2rem;
    font-size: 0.9rem;
    max-width: 32rem;
  }

  dt {
    color: var(--text-mute);
  }

  dd {
    margin: 0;
    color: #ddd;
    font-family: ui-monospace, monospace;
    word-break: break-all;
  }

  .placeholder {
    color: var(--text-mute);
    max-width: 60ch;
    line-height: 1.6;
    font-size: 0.9rem;
  }
</style>
