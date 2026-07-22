# Core Closure Local Happy Path Smoke

## Summary

- Completed CC.7 from the Core Closure Track.
- Added `scripts/local-happy-path-smoke.mjs` for a source-run local smoke path.
- Added root scripts:
  - `local:happy-path`
  - `local:happy-path:test`
- Wired the smoke script test into `pnpm check`.
- Documented the local source-run sequence in `README.md` and `infra/local/README.md`.
- Review fix: changed smoke response parsing to use an explicit bounded stream reader instead of `response.text()`.

## TDD Notes

- Red: `scripts/local-happy-path-smoke.test.mjs` required the missing smoke script, root package command, check gate, and docs.
- Green: implemented the script, package wiring, README instructions, targeted test, and bounded response-read guardrail.

## Performance Notes

- The smoke uses bounded JSON response reads with `LOCAL_SMOKE_MAX_JSON_BYTES`.
- Workspace bootstrap uses one bounded list (`limit=100`) and a single create call only when the configured slug is absent.
- The document upload path uses one Markdown file and then reads exactly one document and one parse artifact by id/version.

## Verification

- Passed:
  - `node --test scripts/local-happy-path-smoke.test.mjs`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
