# Contributing to Warp

Thank you for considering a contribution. This is a public, glass-house repository. The Webspinner Foundation stewards the work; the architecture is described in the *AI Enclosure* manuscript (`~/ai-enclosure/`) and distilled in `WARP-CANON.md`. Read both before contributing anything substantive.

## What we accept

- **Code.** Reference implementations of Cell roles, the Capability Bus, WRAG, the Compute Farm, BYOK gateway logic, audit infrastructure, and supporting tooling.
- **Protocol specifications and clarifications.** Improvements to the spec text, edge-case resolutions, interoperability fixes.
- **Tests.** Especially conformance tests against the protocol specifications.
- **Documentation.** Setup guides, operator handbooks, federation playbooks, accurate non-marketing prose.
- **Translations and localizations** of documentation.
- **Independent assessments.** Security reviews, privacy reviews, performance benchmarks, comparative studies.
- **Bug reports and reproductions.** With detail sufficient to act on.

## What we do not accept

- Contributions that violate the Foundation Pledge (`WARP-CANON.md` §11). Integrations supporting mass surveillance, behavioral targeting, autonomous-weapons targeting, or the other refused use categories will be declined regardless of code quality.
- Contributions that introduce proprietary dependencies the architecture cannot operate without.
- Contributions that drift from the strict vocabulary (`WARP-CANON.md` §2) or the voice and discipline (`WARP-CANON.md` §14) without a `DECISIONS.md` entry justifying the change.
- Marketing material framed as documentation.

## How to contribute

1. **Open an issue first** for anything beyond a small fix. Describe the problem and the proposed approach. Wait for acknowledgment before investing significant time.
2. **Fork the repo, branch from `main`, work on your branch.**
3. **Keep changes focused.** One logical change per pull request. Avoid bundling unrelated work.
4. **Match the code's style.** Follow what is already there. When in doubt, default to clear over clever.
5. **Add tests** for new behavior; update tests when changing existing behavior. A pull request that breaks tests will not be merged until the breakage is justified or repaired.
6. **Write commit messages that explain *why*.** Reference the relevant chapter of the manuscript or section of `WARP-CANON.md` when the change is architecturally meaningful.
7. **Sign off your commits.** See DCO below.
8. **Open a pull request.** Describe what changed, why, and how it was tested. Link the issue.

## Developer Certificate of Origin (DCO)

Every commit must carry a `Signed-off-by` line. The sign-off is your assertion of the Developer Certificate of Origin v1.1 (https://developercertificate.org/) — that you have the right to contribute the work under the project's license.

Add the sign-off automatically with `git commit -s`. The trailer looks like:

    Signed-off-by: Your Name <your-email@example.com>

The name and email must be real and must match your contributing identity. Pull requests with unsigned commits will be asked to amend.

We use DCO rather than a heavyweight CLA at this stage. If Foundation operations ever require a CLA, contributors will be notified before it takes effect.

## Code review and merging

- Maintainers will review pull requests on their own cadence. Expect substantive review, not just a rubber stamp.
- Reviews check: alignment with the Pledge, fidelity to the spec, code quality, test coverage, voice and terminology, license compatibility of any new dependencies.
- Squash-merge is the default for cleanliness. Maintainers may rebase or amend at merge time.
- A merged contribution is the project's contribution. Authorship is preserved in commit history.

## Reporting security issues

Do not file public issues for security vulnerabilities. Until the Foundation publishes a dedicated disclosure address, send security reports through the maintainer contact channels listed in the repository's security policy (forthcoming) or directly to a current maintainer's email.

## Trademark reminder

You may not use *Warp* or *Webspinner* in a fork's name, package name, product name, or any branding that suggests Foundation endorsement of your derivative. See `TRADEMARK.md`.

## Code of conduct

Treat other contributors with respect. The work attracts people with strong views on technology, privacy, and policy; that is welcome. Personal attacks, harassment, and bad-faith argument are not. Maintainers may ban contributors whose conduct is incompatible with productive collaboration. A formal Code of Conduct will be added as the community grows.

## Reference

- `LICENSE` — Apache License 2.0.
- `NOTICE` — attribution and trademark pointer.
- `TRADEMARK.md` — what may and may not bear the names.
- `WARP-CANON.md` — the architectural canon.
- `~/ai-enclosure/` — the manuscript.
