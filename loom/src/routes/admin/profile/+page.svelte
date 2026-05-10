<script lang="ts">
  let { data } = $props();
</script>

<h1>Profile</h1>
<dl>
  <dt>Email</dt>
  <dd>{data.user.email}</dd>
  <dt>User ID</dt>
  <dd>{data.user.id}</dd>
</dl>

<p class="placeholder">
  Wizard profile — name, locale, MFA enrolment, session revocation, Cell identity key — fills out
  as the architecture extends.
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

  dl {
    display: grid;
    grid-template-columns: 8rem 1fr;
    gap: 0.85rem 1.5rem;
    margin: 1.5rem 0 2rem;
    font-size: 0.92rem;
    line-height: 1.5;
    max-width: 40rem;
  }

  dt {
    color: var(--gold-dim);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    padding-top: 0.2rem;
    font-family: var(--font-data);
  }

  dd {
    margin: 0;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    word-break: break-all;
  }

  .placeholder {
    color: var(--text-secondary);
    max-width: 60ch;
    line-height: 1.65;
    font-size: 0.96rem;
    font-family: var(--font-prose);
    font-style: italic;
  }
</style>
