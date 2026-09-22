# i18n build analysis

`i18nAnalysisPlugin()` prints a compact summary during production Vite builds,
before the existing unused-key check. With Vinext it reports once, after combining
the completed client, SSR and RSC graphs. Development does not run the analysis.

The console shows route and diagnostic counts, namespaces protected by dynamic
keys, and the report path. Diagnostic counts include separate environment records.
Individual route/group listings are available in `i18n-routes.json` (or through
`onAnalysis` when `build.write` is false). Each route retains its pattern, source
page, sorted namespaces and the page/shared/lazy/slots groups. Validation failures
still print the affected route and source details.

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
or removed application value imports, including unchanged imports resolved to unanalyzed virtual
modules, are reported as unresolved instead of silently reading
the old runtime module from disk. Rewritten or removed literal dynamic imports
are also blocked: without a stable binding, their replacement cannot be inferred
from call order. Matching checks binding signatures and occurrence counts rather
than merely whether a specifier survives. If uses of one specifier disagree, the
TypeScript host blocks that specifier as a whole because its resolution is shared
across import occurrences. Explicit type-only imports and package declarations
continue to use TypeScript resolution. Package barrel rewrites retain declaration
resolution only when every imported local binding is traced to the same external
package. Resource imports are excluded from diagnostics, while application source
query variants remain distinct throughout dependency and
usage analysis, with separate in-memory compiler filenames. Built JSON modules use
Vite-transformed JavaScript under synthetic compiler filenames, preserving inferred
object keys without loading a different JSON file from disk. JSON data modules inform
types but are not scanned as translation call sites. Reports display their
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
`unknown-namespace` records explicit namespace expressions that cannot be fully
resolved. Each route includes `unknownNamespaceSources` for reachable affected
modules, including shared boundaries, lazy dependencies, slots, and client bridges.
An empty list means no unknown expression was detected, not proof that all APIs or
dependencies were understood.
Namespace loading recognizes string literals, inline arrays/spreads of supported
values, and local/imported `const` string bindings. Const string aliases are followed
with a cycle guard. Parameters, defaults, function results, object properties and
arrays stored in variables remain unknown, even with literal types or `as const`.
No mutation/escape analysis, cross-function namespace forwarding, JSX prop tracking,
or route-policy trust exceptions are performed. Prefer a visible unknown result
over inferring runtime behavior.

## Custom translation APIs

Only official translation API names are built in. Register custom
wrappers with `adapters`, using source module paths relative to the Vite root and
zero-based argument indexes:

```ts
i18nAnalysisPlugin({
  adapters: [
    { module: 'i18n/lib.client.ts', exportName: 'useTranslation', namespaceArgument: 0 },
    {
      module: 'app/route-metadata.ts',
      exportName: 'getRouteMetadata',
      namespaceArgument: 0,
      selectorArgument: 1,
    },
  ],
})
```

`selectorArgument` identifies the key/selector argument of a direct translation
adapter. Omit it for a hook/helper returning an object with a `t` function. Imports
are matched by resolved declarations, including aliases, namespace imports and
re-exports, rather than by function name alone. Named functions and function-valued
variables are supported. A registration is an explicit forwarding contract: the
registered implementation is not scanned for translation usage. Optional
`implementationFunctions` lists additional private forwarding functions in the
same module; other functions remain analyzed. Keep contract tests for registered
wrappers and update the configuration if their behavior changes.

Dify's registrations live in `web/vite.config.ts`, including the server hook's
private `getI18nConfig` and the locale-first `getTranslation` helper. The plugin
contains no Dify wrapper paths or names. Dynamic namespace arguments are diagnosed
at call sites and fail opted-in strict validation. Runtime route Providers are not
registered as adapters. This does not infer arbitrary wrapper implementations.

## Key matching

Key matching retains TypeScript selector and finite key types, direct selectors,
static object-map lookup, and syntactic template-prefix protection. Function bodies
are not executed to infer call results; keys returned by runtime helpers protect
the relevant namespace. This deliberately accepts fewer unused-key findings.

Unresolved import warnings focus on untraceable application source imports.
External packages, explicit node_modules paths, styles, Vite assets (including
query variants), server/client boundary markers and imports introduced only by
transforms are opaque analysis boundaries, not individual warnings. This does not
allow TypeScript to fall back to stale runtime files: blocked targets stay blocked.
Local imports rewritten to virtual or external targets still produce diagnostics.
Missing key or namespace information continues to use the normal conservative
fallbacks. No dependency implementations are scanned to classify their behavior.
An empty unresolved-import list does not imply complete dependency coverage.

A dynamic key can protect an entire namespace; these records explain which calls
prevent an unused-key conclusion.

`metrics` records shared setup, per-environment resolution, Program/checker setup,
semantic analysis and route traversal durations, plus module and resolver-call
counts. `totalMs` sums work for the final environment graphs and final analysis;
it excludes superseded scan graphs, output serialization and the rest of the build,
and is not wall-clock build duration when environments run concurrently.

Catalog, exact-key/plural indexes, wildcard matches and compiler options are shared
within one analysis. Runtime template prefixes are retained even when an assertion
widens the key to every property of a JSON catalog. Identical multi-format builds in the same open bundle reuse
analysis; changes to source, transformed code or graph edges invalidate that reuse.
Closing the bundle or starting a watch rebuild clears it. Programs and type state
are not cached across environments or independent builds.

## Opt-in route namespace validation

Pass `getDeclaredNamespaces(route)` to enable validation for selected route
subtrees. Returning `undefined` skips validation for that route; an empty array
means no namespaces are allowed. Any detected namespace outside the declaration
fails the production build, with the route, namespace, group and source file.
All four groups are checked, including lazy dependencies and parallel slots.
Set `strictNamespaces: true` to also fail declared routes whose
`unknownNamespaceSources` is nonempty. By default these routes emit an incomplete
analysis warning; unrelated unresolved imports do not automatically fail route
validation. Undeclared routes remain exempt from strict validation.
Explicit, statically resolved `useTranslation` / `getTranslation` namespace
arguments are included even when no translation key is consumed.

The application passes `getDeclaredRouteNamespaces` from
`i18n/route-namespaces.ts`, sharing declarations with server resource selection
and client navigation. Currently only `/signin` and its descendants opt in. The
application uses the default non-strict mode: runtime providers emit
unknown warnings, while statically detected undeclared namespaces still fail.
No policy callback substitutes configured values for unknown expressions.
Undeclared routes keep the full catalog and can be migrated independently.

This validates statically detected usage, with the recognition and conservative
limitations described above. It does not prove that arbitrary runtime-generated
imports or unrecognized translation APIs stay within the declaration.
