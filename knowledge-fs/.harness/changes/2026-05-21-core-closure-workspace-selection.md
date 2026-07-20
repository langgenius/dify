# Core Closure Workspace Selection

## Summary

- Added the active Core Closure Track to `.harness/docs/iteration-plan.md`.
- Started CC.1 by changing the Admin Console shell to render primary form actions from loaded `KnowledgeSpace` data when available.
- Added a testable `AdminHomeView` that accepts workspace options and keeps a safe local `workspace` fallback for first-run development.
- The default Admin page now attempts a bounded `listKnowledgeSpaces({ limit: 100 })` server-side load using the local dev token and falls back without crashing if the API is unavailable.
- Marked the Admin page as `force-dynamic` so production builds do not freeze the local fallback workspace during static prerendering.

## TDD Notes

- Red: updated `apps/admin/app/page.test.tsx` to require real workspace ids in upload, golden question, and bad-case form actions; the test failed because `AdminHomeView` did not exist and the page was hardcoded to `workspace`.
- Red: added a dynamic-rendering assertion; it failed while the page could still be statically prerendered.
- Green: extracted `AdminHomeView`, added workspace option rendering, and wired the default page to load workspace options from the API.
- Green: added the supported Next.js `dynamic = "force-dynamic"` segment config and verified `next build` reports `/` as dynamic.

## Performance Notes

- Workspace loading is bounded to 100 rows.
- The page performs one bounded workspace-list request during server render; it does not loop over per-space detail requests.
- Browser form submissions still go through the Admin BFF allowlist.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx`
  - `pnpm build`
  - `pnpm check`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
