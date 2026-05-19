<script lang="ts">
  import type { PageData } from './$types.js';
  import AuthorDashboard from '$lib/components/AuthorDashboard.svelte';
  let { data }: { data: PageData } = $props();
</script>

<AuthorDashboard {data} />
