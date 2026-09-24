# Bundle analysis in pull requests

The main CI calls **Web Bundle Analysis** when its Web style checks are required,
for both pull requests and merge queue entries. It builds the event's exact base
commit and the tested merge commit from `github.sha` in parallel. Both run the
complete existing `vinext build` pipeline, including the unused translations check.
No SSR, reference-analysis, or standalone stage is skipped.

This replaces the separate Vinext build in Web Style. Static checks run alongside
the analysis workflow, and the existing **Web Style** required check succeeds only
when both complete successfully. Main CI owns change detection and duplicate-run
skipping. Target-branch updates alone do not rerun PRs.

The official Rolldown `bundleAnalyzerPlugin` is added only to the client environment
through a temporary Vite config wrapper. Each revision keeps its own application
config and lockfile. The plugin is already bundled with the repository's Vite+
runtime through `vite/rolldown/experimental`; no separate analyzer dependency is
installed. The experimental schema is validated and unsupported data fails the
job instead of appearing as savings.

## Reading the report

The full comparison always appears in the Actions summary. Same-repository PRs
receive an updated comment only when the absolute gzip change reaches at least
5 KiB for all client JS, 1 KiB for client CSS, or 2 KiB for any entry present in
both revisions. Increases and decreases both qualify. Raw sizes, package
attribution, and added/removed entry boundaries do not independently trigger a
comment. If a later run falls below every threshold, the existing report comment
is removed to avoid leaving stale results.

Merge queue runs receive the summary and artifacts without
a PR comment. Fork PRs receive the summary and artifacts without a
privileged build or comment token. Reports are informational: growth does not fail
the check; build, analysis, and reporting errors do.

- **All client JS:** actual bytes and per-file gzip of the chunks listed in the
  official analyzer. Includes dynamically imported chunks.
- **Client CSS:** emitted CSS under `dist/client/_next/static`, excluding copied
  public assets.
- **Entry static dependencies:** recursively follows static chunk edges, with
  shared chunks counted once within an entry. Application source paths identify
  entries independently of output hashes. Dynamic entries are measured when
  loaded; these are not full-page first-load measurements. Entries overlap and
  cannot be summed. The comment shows the 20 largest absolute gzip changes.
  Added/removed entry boundaries appear separately and are not treated as size
  changes from zero.
- **Package attribution:** groups module sizes from the official analyzer by npm
  package. This is attribution, not compressed output size; the comment shows the
  15 largest absolute changes.

This measures Vinext/Rolldown output, not Next.js/Turbopack production output or
browser network timings. Compiler versions are recorded in both snapshots.

Both revisions upload the official JSON and Markdown reports, build logs, and
size snapshots for 14 days. The summary links to these artifacts; no local viewer
is required. We do not rely on Vite DevTools' incomplete static Session Compare.

See the [Rolldown analyzer documentation].

## Local collection

The `instrument` command renames `vite.config.ts` and writes a temporary wrapper.
Use it only in a disposable checkout, as CI does:

```sh
node web/scripts/bundle-analysis.ts instrument web
pnpm --dir web exec vinext build
node web/scripts/bundle-analysis.ts collect web "$(git rev-parse HEAD)" /tmp/current.json
node web/scripts/bundle-analysis.ts compare /tmp/base.json /tmp/current.json /tmp/report.md
```

## Next.js / Turbopack analysis

The Web `analyze` script uses Next.js's built-in Turbopack analyzer:

```sh
pnpm --dir web analyze --output
```

Save `web/.next/diagnostics/analyze` before changing code, then collect another
report with the same compiler version and environment. Omit `--output` to open
the interactive analyzer and inspect route-specific client/server import chains.
These reports are separate from the Vinext snapshots above.

If analysis panics inside `next-api/src/nft.rs`, move
`web/.next/cache/turbopack` outside `.next` and retry before changing production
configuration. A stale filesystem cache caused this failure locally with
Next.js 16.3.6; rebuilding the cache let the unchanged configuration complete.

Check import chains before adding configuration. Next.js already optimizes
imports from libraries such as `ahooks` and Heroicons. `serverExternalPackages`
affects server bundling; it does not remove dependencies from browser bundles.

A lazy component can still have eager dependencies if shared utilities import
its SDK statically. Console analytics keeps its initialization state and event
helpers lightweight, loading Amplitude and session replay only after analytics
is enabled and consent is granted. Keep SDK imports in shared helpers type-only
and use the initialized client for events. When changing this boundary, verify
revocation and unmount during loading, concurrent initialization, and failure
recovery as well as entry static dependencies and total emitted bytes.

[Rolldown analyzer documentation]: https://rolldown.rs/builtin-plugins/bundle-analyzer
