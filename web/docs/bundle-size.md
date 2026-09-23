# Bundle size reports

The **Web Bundle Size** workflow compares the target branch commit with the PR merge commit
when Web, shared packages, dependency manifests, or the workflow change. Each
revision uses its own lockfile and the same collector. It builds both revisions
instead of relying on a potentially stale default-branch artifact. Both commits
are fixed by the triggering event: `pull_request.base.sha` and `github.sha`
(the GitHub-generated merge commit). This measures the effect of merging the PR
into that target revision, even when the PR branch is behind. Target-branch
updates alone do not rerun existing PRs; rerunning an old workflow keeps its
original revisions. PRs with merge conflicts cannot run this workflow.

The workflow is report-only: increases do not fail it. Build errors, missing
chunks, and incompatible statistics do fail it so they cannot look like savings.
Same-repository PRs receive an updated comment. Fork PRs receive the same report
in the Actions job summary and can download the artifacts.

## Measurements

- **Route initial JavaScript:** Next.js's
  `.next/diagnostics/route-bundle-stats.json` supplies `firstLoadChunkPaths`.
  Files are deduplicated within each route, including shared layouts/runtime.
  Routes overlap and must not be summed. The summary shows the 20 largest changes
  by absolute gzip delta; the JSON artifacts contain every route.
- **All emitted client chunks:** JS and CSS under `.next/static/chunks`, including
  asynchronous chunks. This catches output growth that does not affect initial
  route JS, such as unused syntax-highlighting themes.
- **Gzip:** each file is compressed separately and the sizes are summed. This is
  a build metric, not observed network transfer, cached navigation, or load time.

Next.js upgrades can change chunking and statistics. The report records both
versions and calls out differences. The collector intentionally fails on missing
or incompatible route data instead of falling back to guessed sizes.

## Official analyzer

`next build --experimental-analyze --experimental-build-mode compile` emits the
real chunks, route statistics, and the official Next.js analyzer in a single
compilation. Compile mode does not validate full prerendering or require the Dify
backend. The workflow uploads `web-bundle-analyzer-base` and
`web-bundle-analyzer-merge` with 14-day retention.

After downloading and extracting a report, serve its directory locally, for
example with `python3 -m http.server 4000`, then open `http://localhost:4000`.
The report retains Next.js's route/environment filters, treemap, and import-chain
inspection. We do not parse the analyzer's internal binary format.

For analyzer-only local work, `pnpm --filter dify-web analyze --output` remains
available. That command does not produce an application build and cannot replace
the build step used to collect gzip sizes from real chunks.

See the [Next.js package bundling guide].

## Local commands

From the repository root, after building the desired revision:

```sh
node web/scripts/bundle-size.ts collect web "$(git rev-parse HEAD)" /tmp/bundle-head.json
node web/scripts/bundle-size.ts compare /tmp/bundle-base.json /tmp/bundle-head.json /tmp/bundle-report.md
pnpm --dir web exec vp test run --project unit scripts/__tests__/bundle-size.spec.ts
```

[Next.js package bundling guide]: https://nextjs.org/docs/app/guides/package-bundling
