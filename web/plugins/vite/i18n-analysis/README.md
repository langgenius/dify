# i18n build analysis

`i18nAnalysisPlugin()` prints a route namespace report during production Vite builds,
before the existing unused-key check. With Vinext it reports once, after combining
the completed client, SSR and RSC graphs. Development does not run the analysis.

Each route contains its pattern, source page, sorted namespaces and four groups:

```text
/items/[id] (app/(console)/items/[id]/page.tsx): app, common, workflow
  page: app
  shared: common
  lazy: workflow
  slots: (none detected)
```

The report follows resolved static and dynamic imports, including virtual modules,
and adds ancestor layouts, templates, loading/error/not-found boundaries. Route
groups are omitted from the URL pattern. Parallel slots include all built branches
because their active page can depend on navigation history. Interception segments
remain visible in labels; the source page disambiguates entries with the same URL.

## Module resolution

Vite owns module identity and runtime import resolution. Each completed environment
retains original source in module metadata and resolves surviving imports through
that environment's plugin resolver. When a transform changes an import specifier,
matching import/export bindings connect it back to the original source. Ambiguous
or removed value imports, including unchanged imports resolved to unanalyzed virtual
modules, are reported as unresolved instead of silently reading
the old runtime module from disk. Rewritten or removed literal dynamic imports
are also blocked: without a stable binding, their replacement cannot be inferred
from call order. Matching checks binding signatures and occurrence counts rather
than merely whether a specifier survives. If uses of one specifier disagree, the
TypeScript host blocks that specifier as a whole because its resolution is shared
across import occurrences. Explicit type-only imports and package declarations
continue to use TypeScript resolution. Package barrel rewrites retain declaration
resolution only when every imported local binding is traced to the same external
package. Vite-recognized asset imports without queries are excluded from missing
source-import diagnostics; query variants remain eligible for diagnostics. Query variants remain distinct throughout dependency and
usage analysis, with separate in-memory compiler filenames. Reports display their
underlying source paths.

This is a conservative module-level estimate, not a runtime loading manifest.
It shares the unused-key analyzer's translation recognition and dynamic-key
fallbacks. Unresolved namespaces can include the entire catalog. Unused exports,
conditional branches, lazy features and parallel slots can overestimate usage;
runtime-only imports or unrecognized translation APIs can be missed. Only pages
and boundaries present in the build graph are reported. Reporting alone does not
change translation loading or introduce additional build failures.

## Groups and source files

- `page`: the page and its transitive static imports.
- `shared`: ancestor layouts, templates and loading/error/not-found boundaries,
  including their transitive static imports. This includes same-segment boundaries.
- `lazy`: modules reached through dynamic imports from the page or shared entries,
  excluding modules already statically reachable from either. Dynamic import does
  not prove that a feature loads only after user interaction.
- `slots`: modules reachable from all built ancestor parallel-slot branches,
  excluding modules already reachable from the page/shared entries (including lazy).

Page and shared groups can overlap. A namespace can appear in multiple groups
when different modules use it; group counts must not be added to obtain the total.
Dependencies retain their environment identity. Only explicit `use client`
directives connect an RSC reference to the same module's SSR and client versions;
ordinary shared filenames do not connect environments. The RSC reference stub is
analyzed as generated code, with implementation usage coming from SSR and client.
Route reports are then merged by source page. A group can differ across environments.
This is not a client-only bundle analysis. Custom environment names or other
framework-specific cross-environment reference mechanisms are not inferred.

When build output writing is enabled, `<build.outDir>/i18n-routes.json` contains
`{ version: 3, routes, modules, paths, evidence, metrics }`, including when no routes were detected.
Every route retains `route`, `page` and `namespaces`, with `groups` mapping each
category to `{ namespace, sources, dependencyPaths }` entries. Each dependency
path is an index into the shared `paths` table. Each table entry is a
`[moduleIndex, parentPathIndex]` tuple; a null parent starts a chain. `moduleIndex`
indexes `modules`, whose entries contain `{ environment, moduleId }`, preserving
queries and virtual IDs. Follow parents and reverse the steps to reconstruct a
chain. Shared prefixes are stored once across routes and namespaces.
Paths provide one shortest discovered explanation per reachable source and environment,
not an enumeration of every possible path. Sources are
sorted paths relative to the Vite root and identify modules containing recognized
translation usage, not necessarily the entire chain of imports leading to them.
The report is written before namespace validation and the unused-key check, so
it remains available if either check fails. `build.write: false` only prints the summary and writes no report.
The optional `onAnalysis(report)` callback receives the same report before validation.

`evidence` records recognized usage, dynamic-key protection and unresolved imports,
with environment, full module ID, relative file path and one-based line/column.
A dynamic key can protect an entire namespace; these records explain which calls
prevent an unused-key conclusion. Unresolved imports make the analysis incomplete.

`metrics` records shared setup, per-environment resolution, Program/checker setup,
semantic analysis and route traversal durations, plus module and resolver-call
counts. `totalMs` sums work for the final environment graphs and final analysis;
it excludes superseded scan graphs, output serialization and the rest of the build,
and is not wall-clock build duration when environments run concurrently.

Catalog, exact-key/plural indexes, wildcard matches and compiler options are shared
within one analysis. Identical multi-format builds in the same open bundle reuse
analysis; changes to source, transformed code or graph edges invalidate that reuse.
Closing the bundle or starting a watch rebuild clears it. Programs and type state
are not cached across environments or independent builds.

## Opt-in route namespace validation

Pass `getDeclaredNamespaces(route)` to enable validation for selected route
subtrees. Returning `undefined` skips validation for that route; an empty array
means no namespaces are allowed. Any detected namespace outside the declaration
fails the production build, with the route, namespace, group and source file.
All four groups are checked, including lazy dependencies and parallel slots.
Explicit, statically resolved `useTranslation` / `getTranslation` namespace
arguments are included even when no translation key is consumed.

The application passes `getDeclaredRouteNamespaces` from
`i18n/route-namespaces.ts`, sharing declarations with server resource selection
and client navigation. Currently only `/signin` and its descendants opt in.
Undeclared routes keep the full catalog and can be migrated independently.

This validates statically detected usage, with the recognition and conservative
limitations described above. It does not prove that arbitrary runtime-generated
imports or unrecognized translation APIs stay within the declaration.
