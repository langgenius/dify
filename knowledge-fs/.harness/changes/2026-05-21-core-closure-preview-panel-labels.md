# Core Closure Preview Panel Labels

## Summary

- Completed CC.6 from the Core Closure Track.
- Marked secondary Admin panels that still use static/demo data as `Preview`.
- Kept live primary paths unchanged: health, upload, publish readiness, workspace selection, and query form.

## TDD Notes

- Red: Admin page test required all secondary static panels to include `Preview data` copy and `Preview` badges.
- Green: updated the page headers/badges and adjusted the shell test to stop treating demo retrieval studio data as live winner status.

## Performance Notes

- UI-only change. No new API calls, database reads, fanout, or client-side polling were introduced.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
