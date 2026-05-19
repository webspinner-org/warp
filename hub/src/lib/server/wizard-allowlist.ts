/**
 * Wizard allowlist — email addresses that get super-user privileges
 * inside the hub. Wizards see the admin utilities mirror; patrons
 * see only what they own (ownership semantics arrive after MVP-1).
 *
 * Sourced from the env var `WARP_HUB_WIZARDS` (comma-separated emails,
 * case-insensitive). Anyone not on this list is a regular patron.
 * Empty list (the bootstrap default) means no wizards, which is
 * fine — every authenticated user is just a patron until the env
 * is set.
 */

function readWizardSet(): ReadonlySet<string> {
  const raw = process.env['WARP_HUB_WIZARDS'] ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export function isWizard(email: string | null | undefined): boolean {
  if (!email) return false;
  return readWizardSet().has(email.trim().toLowerCase());
}
