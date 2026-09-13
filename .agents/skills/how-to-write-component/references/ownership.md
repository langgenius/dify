# Component Ownership And Modules

Read this document when adding, moving, splitting, or refactoring React components or feature modules.

## Vertical Modules

- Organize code by product workflow, route, or behavior owner. Keep components, hooks, local types, atoms, query helpers, tests, and small utilities beside the code that changes with them.
- Name page and tab folders after the current route, tab, or user-visible surface. Do not preserve stale parent groupings that no longer own multiple surfaces.
- Split a growing page or tab by product or visual owners. Keep the feature root for its public entrypoint and genuinely cross-owner coordination.
- Import other features only through explicit public entrypoints. Avoid barrels that merely re-export secondary owners.
- Promote code outside a feature only when multiple verticals use the same stable contract. Possible future reuse is not sufficient.

## Component Ownership

- Put state, data access, loading, empty, error, and handlers in the lowest owner that uses them and whose mounted lifetime matches the required persistence.
- Keep coordination in a parent only when it needs one consistent snapshot, the value must intentionally survive the local owner's unmount, or the parent coordinates submission, shared selection, batch behavior, navigation, or cross-section loading and errors.
- Repeated TanStack Query hooks for the same key and input in Client Component siblings under one QueryClient are
  acceptable; shared cache is not a reason to hoist. Separate Server Component QueryClients do not share it, so
  request-level deduplication needs an identified request-local cache or verified framework or transport owner.
- Pass stable domain identity across boundaries. Do not pass raw server data together with separately derived flags for the same concept.
- Revisit prop forwarding when intermediate components obscure the behavior owner; keep clear data flow rather than introducing shared state merely to avoid passing props.
- Do not replace prop drilling with one large view-model hook. Move each query, derived value, and handler to the concrete owner that consumes it.
- Keep source selection, defaults, validation, dirty checks, and payload shaping beside the workflow that owns submission.

## Boundaries

- Prefer reusing or extending the component that already owns an interaction over rebuilding that behavior in a parallel component.
- State-heavy wizards, drawers, modals, and secondary workflows can form a small vertical surface with an entrypoint, optional feature-local state, and shallow owners matching real visual regions.
- The entrypoint owns route integration, provider wiring, placement, and open-state coordination. A content or session owner keeps state scoped to that mounted surface.
- Judge hook lifetime by the component that declares the hook and the primitive's mount contract, not only by where its rendered controls appear in JSX.
- Separate hidden dialogs, dropdowns, and popovers into small local owners when their content obscures the parent flow.
- Keep cohesive forms, menu bodies, and one-off helpers local unless they have their own state, reuse, or semantic boundary.
- Extract components or hooks when they clarify ownership or hide a cohesive implementation; keep logic local when extraction only shortens the file or relocates the same coordination.
- Avoid wrapper components and wrapper DOM that only rename props, pass children through, or hide the real primitive. A wrapper must own behavior, validation, state, accessibility, layout, or library integration.
- Keep feature workflows out of shared components: do not encode one feature through many boolean props or import its copy, routes, and API contracts into a generic component. Do not pass pre-rendered fragments merely to avoid assigning the behavior to its owner.
- Loading states for page sections, cards, lists, tables, forms, and drawers should use skeletons scoped to the loaded content. Reserve spinners for small inline busy indicators.

## Components And Types

- Choose component declaration and export forms from the actual component contract, framework requirements, and enforced package rules. Existing style is context, not authority; do not rewrite unaffected code solely to normalize `FC`, `function`, arrow-function, named-export, or default-export forms.
- Use API-generated or API-returned types at component boundaries. Keep one-off UI refinements and conversions beside their owner.
- Name props and converted data after their domain/API role, preserving traceability to the original contract.
- Preserve domain value types for selections. Do not widen enums, unions, booleans, numbers, objects, or nullable values to `string` before a real boundary requires it.
- Avoid generic `common.tsx` buckets and aliases that only rename another type. Name files, values, and public types after their domain role.
- Put fallback and invariant checks in the lowest component that already renders that state. Do not extract helpers whose only purpose is hiding missing display data.
