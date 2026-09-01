# Component Ownership And Modules

Read this document when auditing, adding, moving, splitting, or refactoring React components or feature modules.

## Vertical Modules

- Organize code by product workflow, route, or behavior owner. Keep components, hooks, local types, atoms, query helpers, tests, and small utilities beside the code that changes with them.
- Name page and tab folders after the current route, tab, or user-visible surface. Do not preserve stale parent groupings that no longer own multiple surfaces.
- Split a growing page or tab by product or visual owners. Keep the feature root for its public entrypoint and genuinely cross-owner coordination.
- Import other features only through explicit public entrypoints. Avoid barrels that merely re-export secondary owners.
- Promote code outside a feature only when multiple verticals use the same stable contract. Possible future reuse is not sufficient.

## Component Ownership

- Before declaring state, a query, or a workflow hook in a page or parent, identify the direct descendant branches that consume each returned value.
- If only one branch consumes a value, declare it in the lowest owner in that branch. The parent may pass stable identity or the smallest boundary input, but must not own child state merely to construct props.
- A parent may own a value when several sibling branches require one live snapshot and the parent genuinely derives or coordinates submission, selection, navigation, lifecycle, loading, or errors. If it only destructures, renames, and forwards fields, it is a switchboard rather than an owner; put the shared workflow in a feature-local state graph so each surface consumes only its named facts and commands. Use a provider only when it becomes the authoritative input, scope, or external-dependency owner.
- A provider is a real boundary only when it establishes authoritative input, scope/isolation, or a stable external dependency. A provider that calls a large hook and repackages its return value into Context remains a switchboard.
- A page or feature root may wire route identity, providers, layout, navigation, and genuine cross-surface coordination. It must not call a child-specific state or query hook merely to assemble that child's props.
- Keep child contracts at the ownership boundary: stable domain identity, a small immutable snapshot, placement options, or named cross-boundary commands. Do not pass an internal state machine as separate `data`, `pending`, `error`, `retry`, `open`, setter, and callback props when the parent does not use them, and do not hide the same fan-out in a props bag or hook result object.
- Repeated TanStack Query calls in siblings are acceptable when each sibling independently consumes the data; the cache already deduplicates requests.
- Treat parent input according to what the child boundary does with it:
  - If the child only renders or performs a light local decision, pass the snapshot as props. It does not become a new state owner.
  - If the child builds queries, dialogs, mutations, derivations, commands, or a reset lifecycle around a stable identity or snapshot, give that boundary a feature-local state file. This does not by itself require a new module or directory.
- Pass stable domain identity or the smallest sufficient action snapshot across boundaries. Do not copy props into atoms merely to avoid passing them, and do not pass raw server data together with separately derived flags for the same concept.
- One pass-through layer is acceptable for stable identity and placement. It is not permission to relay workflow state and handlers through an unrelated component.
- Route identity may pass once from a framework route into its feature boundary. If multiple descendants, queries, facts, or commands need it, bridge it into the feature graph and stop passing it as props.
- A query snapshot may cross once as immutable display input. Query keys, observer methods, retry/loading/error groups, and invalidation mechanics belong to the query surface or feature graph and must not be decomposed into props.
- Keep source selection, defaults, validation, dirty checks, and payload shaping beside the workflow that owns submission.

## Boundaries

- State-heavy wizards, drawers, modals, and secondary workflows can form a small vertical surface with an entrypoint, optional feature-local state, and shallow owners matching real visual regions.
- The entrypoint owns route integration, provider wiring, placement, and open-state coordination. A content or session owner keeps state scoped to that mounted surface.
- Judge hook lifetime by the component that declares the hook and the primitive's mount contract, not only by where its rendered controls appear in JSX.
- Separate hidden dialogs, dropdowns, and popovers into small local owners when their content obscures the parent flow.
- Keep cohesive forms, menu bodies, and one-off helpers local unless they have their own state, reuse, or semantic boundary.
- Avoid wrapper components and wrapper DOM that only rename props, pass children through, or hide the real primitive. A wrapper must own behavior, validation, state, accessibility, layout, or library integration.
- Loading states for page sections, cards, lists, tables, forms, and drawers should use skeletons scoped to the loaded content. Reserve spinners for small inline busy indicators.

## Components And Types

- Choose component declaration and export forms from the actual component contract, framework requirements, and enforced package rules. Existing style is context, not authority; do not rewrite unaffected code solely to normalize `FC`, `function`, arrow-function, named-export, or default-export forms.
- Type simple one-off props inline. Name a `Props` type when it is reused, exported, complex, or materially clearer.
- Use API-generated or API-returned types at component boundaries. Keep one-off UI refinements and conversions beside their owner.
- Preserve domain value types for selections. Do not widen enums, unions, booleans, numbers, objects, or nullable values to `string` before a real boundary requires it.
- Avoid generic `common.tsx` buckets and aliases that only rename another type. Name files, values, and public types after their domain role.
- Put fallback and invariant checks in the lowest component that already renders that state. Do not extract helpers whose only purpose is hiding missing display data.
