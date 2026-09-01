# Component Ownership And Modules

Read this document when auditing, adding, moving, splitting, or refactoring React components or feature modules.

## Root-To-Leaf Architecture Audit

For a named component, use it as the audit root. For a refactoring request, use the nearest route, page, feature entrypoint, or behavior owner whose state contract is changing.

1. Build the complete locally owned rendered component tree from the root to every leaf. Follow imported feature components, conditional branches, lists, portals, dialogs, drawers, popovers, and secondary surfaces. Stop at third-party primitives, Dify UI primitives, or an explicit stable feature boundary, but record the props passed across the final edge.
2. At every component, inventory React state and reducers, form and uncontrolled DOM state, URL and route state, context/Jotai/store reads and writes, queries, mutations, refs that hold workflow or lifecycle state, custom-hook results, render-time derived facts, and workflow commands or handlers.
3. For every value, record its authoritative owner/source, graph role, declaring component, consuming branches, lifetime and reset/isolation requirements, and whether it is local, shared, forwarded, mirrored, or persisted.
4. Inspect every props edge. Mark each prop as consumed by the child, forwarded unchanged, renamed, recomputed, mirrored into local state, or paired with lifecycle fields such as `data/pending/error/retry` and `open/onOpenChange`.
5. Evaluate ownership only after the complete paths are mapped. A value consumed by one branch belongs in the lowest owner in that branch. A parent may own a value when several sibling branches require one live snapshot or coordinated lifecycle. A parent that mainly destructures a workflow hook and redistributes fields is a switchboard, not necessarily the workflow owner.
6. Produce both the current and target architecture before recommending component splits. Treat the current component and file layout as evidence, not as a constraint on the target tree. Group related ownership problems at the highest incorrect owner instead of repeating the same issue for every descendant. Do not replace prop fan-out with a props bag, context, or state graph unless the new boundary becomes the real owner and exposes narrower facts and commands.
7. Give every current local component an explicit target disposition: keep, split, merge, remove, rename, promote to an owner, or demote to presentation. Map every current state or workflow owner to a target component. A rename, facade wrapper, props bag, or provider around the same switchboard does not count as a new component boundary.
8. Redraw the target rendered tree from the ownership decisions. Split when state lifetime, interaction lifecycle, behavior ownership, or an independently changing visual region establishes a real boundary. Merge or remove components that only forward, rename, or obscure a single owner's contract. Do not split only to reduce line count or make the tree visually symmetrical.

The audit is incomplete until every locally owned rendered path, meaningful props edge, and stateful value is represented in the component tree, state inventory, or props-edge ledger; every current local component has a target disposition; and every current state/workflow owner maps to a target component and reset boundary. Correctness bugs may illustrate an ownership defect, but architecture-audit mode does not prioritize or severity-rank bug findings.

## Vertical Modules

- Organize code by product workflow, route, or behavior owner. Keep components, hooks, local types, atoms, query helpers, tests, and small utilities beside the code that changes with them.
- Name page and tab folders after the current route, tab, or user-visible surface. Do not preserve stale parent groupings that no longer own multiple surfaces.
- Split a growing page or tab by product or visual owners. Keep the feature root for its public entrypoint and genuinely cross-owner coordination.
- Import other features only through explicit public entrypoints. Avoid barrels that merely re-export secondary owners.
- Promote code outside a feature only when multiple verticals use the same stable contract. Possible future reuse is not sufficient.

## Component Ownership

- Before declaring state, a query, or a workflow hook in a page or parent, identify the direct descendant branches that consume each returned value.
- If only one branch consumes a value, declare it in the lowest owner in that branch. The parent may pass stable identity or the smallest boundary input, but must not own child state merely to construct props.
- A parent may own a value when several sibling branches require one live snapshot and the parent genuinely derives or coordinates submission, selection, navigation, lifecycle, loading, or errors. If it only destructures, renames, and forwards fields, it is a switchboard rather than an owner; put the shared workflow in a feature-local state graph or provider so each surface consumes only its named facts and commands.
- A page or feature root may wire route identity, providers, layout, navigation, and genuine cross-surface coordination. It must not call a child-specific state or query hook merely to assemble that child's props.
- Keep child contracts at the ownership boundary: stable domain identity, a small immutable snapshot, placement options, or named cross-boundary commands. Do not pass an internal state machine as separate `data`, `pending`, `error`, `retry`, `open`, setter, and callback props when the parent does not use them, and do not hide the same fan-out in a props bag or hook result object.
- Repeated TanStack Query calls in siblings are acceptable when each sibling independently consumes the data; the cache already deduplicates requests.
- Treat parent input according to what the child boundary does with it:
  - If the child only renders or performs a light local decision, pass the snapshot as props. It does not become a new state owner.
  - If the child builds queries, dialogs, mutations, derivations, commands, or a reset lifecycle around a stable identity or snapshot, give that boundary a feature-local state file. This does not by itself require a new module or directory.
- Pass stable domain identity or the smallest sufficient action snapshot across boundaries. Do not copy props into atoms merely to avoid passing them, and do not pass raw server data together with separately derived flags for the same concept.
- One pass-through layer is acceptable for stable identity and placement. It is not permission to relay workflow state and handlers through an unrelated component.
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
