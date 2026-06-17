# Component Architecture Rules

Use these rules for React component structure, ownership, state, props, effects, and module organization.

## Ownership

Flag:

- State, query, mutation, or handlers hoisted above the lowest component that actually uses them.
- Parent components owning row/item actions that do not coordinate a workflow.
- Prop drilling through multiple pass-through layers.
- A page/tab-level section component becoming the data owner without needing a shared snapshot or shared loading/error/empty UI.
- Feature code promoted to shared only because it appears once or might be reused later.

Accept repeated TanStack Query calls in siblings when each component independently consumes the data. Cache deduplication is not a reason to hoist by itself.

## Component Boundaries

Flag:

- React component files over 300 lines when the file mixes multiple responsibilities that can be split into focused colocated components, hooks, or utilities.
- Shallow wrappers that only rename props or hide the real primitive.
- Extra DOM wrappers that do not provide layout, semantics, accessibility, state ownership, or library integration.
- Dialog/dropdown/popover hidden surfaces that obscure the parent flow when they should be extracted into a small local component.
- Business forms, menu bodies, or one-off helpers moved away from their owner without reuse or semantic value.

Prefer colocated components split by actual data and state needs.

## Bad Component Design Patterns

Flag:

- Refactors of existing navigation, sidebar, dropdown, webapp list, or app-switching UI that do not preserve behavior-sensitive interactions such as expand/collapse arrows, hover persistence, pin/delete controls, routing, keyboard/focus handling, or open-state ownership.
- Components that mix data fetching, mutation side effects, popup state, form validation, layout, and row rendering without a clear owner.
- Generic components with many boolean props that encode one feature's workflow.
- A shared component that imports feature-specific copy, routes, or API contracts.
- A feature component that accepts pre-rendered fragments only to avoid placing ownership correctly.
- A child component that receives both raw server data and separately derived flags for the same concept.
- A wrapper that changes accessible semantics of the primitive it wraps.
- A component that exposes controlled props but still keeps a competing private state for the same value.
- A component that cannot render empty, loading, or missing optional API fields without caller-side preprocessing.

When existing components already own interaction logic, prefer reusing or extending them. If a refactor is necessary, preserve the old interaction contract and add or update focused tests for changed behavior.

## Props And Types

Flag:

- `React.FC` / `FC`.
- Default exports outside framework-required files.
- Named `Props` types for trivial one-off props where inline typing is clearer.
- Props named by UI implementation instead of domain/API role.
- API data converted too early or under a generic name that breaks traceability.
- Callers duplicating fallback checks that the lowest rendering component already handles.

Prefer top-level `function` declarations for components and module helpers. Use arrow functions for callbacks and local lambdas.

## Effects

Flag effects that:

- Transform props/state for rendering.
- Copy one state value into another representing the same concept.
- Handle user actions that belong in event handlers.
- Reset state from props when a keyed reset, stable ID, or render-time derivation would work.
- Fetch data that belongs in framework APIs or TanStack Query.

If an effect remains, it must synchronize with a named external system: browser API, subscription, timer, analytics-on-visibility, non-React widget, or imperative DOM integration.

## State Modeling

Flag:

- Storing derived booleans, disabled flags, default tabs, or loading labels that can be calculated from current query/feature state.
- Local state used to fake server data or generated contract fields.
- UI state persisted to localStorage when it is live app state.
- Feature-local mock shells wired to unrelated existing APIs before the real API is confirmed.

Prefer render-time derivation. Keep true local state for user choices, transient input, controlled popups, and feature UI state that has no server source.

## Navigation

Flag:

- Imperative router navigation for ordinary links.
- Button semantics used for navigation.
- Navigation state hidden in component state when URL state is required for shareable filters, tabs, or pagination.

Use `Link` for normal navigation. Use router APIs for mutation success, guarded redirects, command flows, or form submission side effects.
