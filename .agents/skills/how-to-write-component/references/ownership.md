# Component Ownership And Modules

Read this document when adding, moving, splitting, or refactoring React components or feature modules.

## Vertical Modules

- Organize code by product workflow, route, or behavior owner. Keep components, hooks, local types, atoms, query helpers, tests, and small utilities beside the code that changes with them.
- Name page and tab folders after the current route, tab, or user-visible surface. Do not preserve stale parent groupings that no longer own multiple surfaces.
- Split a growing page or tab by product or visual owners. Keep the feature root for its public entrypoint and genuinely cross-owner coordination.
- Import other features only through explicit public entrypoints. Avoid barrels that merely re-export secondary owners.
- Promote code outside a feature only when multiple verticals use the same stable contract. Possible future reuse is not sufficient.

## Component Ownership

- Put state, data access, loading, empty, error, and handlers in the lowest visual owner that uses them.
- Keep coordination in a parent only when it needs one consistent snapshot or coordinates submission, shared selection, batch behavior, navigation, or cross-section loading and errors.
- Repeated TanStack Query calls in siblings are acceptable when each sibling independently consumes the data; the cache already deduplicates requests.
- Pass stable domain identity across boundaries. Do not pass raw server data together with separately derived flags for the same concept.
- One pass-through prop layer is acceptable. Repeated forwarding means ownership should move closer to the consumer or into feature-scoped shared state.
- Do not replace prop drilling with one large view-model hook. Move each query, derived value, and handler to the concrete owner that consumes it.
- Keep source selection, defaults, validation, dirty checks, and payload shaping beside the workflow that owns submission.

## Boundaries

- State-heavy wizards, drawers, modals, and secondary workflows can form a small vertical surface with an entrypoint, optional feature-local state, and shallow owners matching real visual regions.
- The entrypoint owns route integration, provider wiring, close behavior, and mounting. Composition owners handle workflow branches; the closest visual owner handles section branches.
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
