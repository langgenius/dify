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
Environment graphs are combined conservatively, so a static path in any environment
makes a module static for this report. This is not a client-only bundle analysis.

When build output writing is enabled, `<build.outDir>/i18n-routes.json` contains
`{ version: 1, routes }`. Every route retains `route`, `page` and `namespaces`, with
`groups` mapping each category to `{ namespace, sources }` entries. Sources are
sorted paths relative to the Vite root and identify modules containing recognized
translation usage, not necessarily the entire chain of imports leading to them.
The report is written before namespace validation and the unused-key check, so
it remains available if either check fails. `build.write: false` only prints the summary and writes no report.

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
