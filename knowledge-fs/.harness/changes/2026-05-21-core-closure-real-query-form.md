# Core Closure Real Query Form

## Summary

- Completed CC.5 from the Core Closure Track.
- Replaced the static Admin retrieval controls with a real `POST /api/admin-query` form.
- Added a bounded server redirect handler that calls the shared Admin API client `streamQuery`, summarizes SSE answer deltas, and redirects the user back to the Admin page with answer, citations, and trace id.
- Added a Next route for the query form and rendered success/failure query result states on the Admin home page.

## TDD Notes

- Red: Admin page tests required a real query form and query-result rendering; `query-action` tests referenced a missing handler.
- Green: implemented `createRunQueryRedirectHandler`, `/api/admin-query`, page parsing/rendering, and targeted tests.

## Performance Notes

- The query form path uses the existing Admin API client SSE size limit and query byte limit.
- Redirect answer text is bounded to 2 KiB by default to avoid oversized URLs and unbounded memory growth.
- Query requests are a single upstream `/queries` call; no per-citation fanout is added on the home page.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/query-action.test.ts`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
