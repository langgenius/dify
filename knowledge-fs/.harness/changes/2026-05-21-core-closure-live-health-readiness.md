# Core Closure Live Health Readiness

## Summary

- Completed CC.4 from the Core Closure Track.
- Replaced static top health cards with a bounded `/health` read through the shared Admin API client.
- Health cards now show live gateway/component state or an explicit `Unavailable` fallback when the API cannot be reached.
- Publish readiness now reflects the latest upload result instead of a hardcoded sample document.

## TDD Notes

- Red: Admin page tests required `Unavailable` fallback health, live component states from `/health`, and latest-upload readiness text.
- Green: added health loading, component-to-card mapping, and upload-result-based readiness rendering.

## Performance Notes

- Admin home performs one `/health` request and one bounded `listKnowledgeSpaces({ limit: 100 })` request during server render.
- No per-component health fanout happens in the Admin app; component aggregation remains owned by the API `/health` endpoint.
- Publish readiness uses existing upload redirect data and does not add document/artifact reads on the home page.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm build`
  - `pnpm check`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
