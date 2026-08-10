# Component Effects, Navigation, And Runtime Cost

Read this document when a change introduces Effects, navigation side effects, memoization, preloading, or render-cost optimizations.

## Effects

- Keep render pure: do not read or write `ref.current` during render except for predictable null-guarded lazy initialization. Update interaction-owned refs in event handlers, synchronize external-system refs after commit, and use state or derivation for rendered values.
- Use Effects only to synchronize with a named external system such as a browser API, subscription, timer, analytics integration, non-React widget, or imperative DOM API.
- Do not use Effects to transform render state, handle user actions, copy query data, reset state from props, or fetch data owned by framework APIs or TanStack Query.
- Initialize query-backed forms with keyed remounts or surface-entry hydration instead of copying data through Effects.

## Navigation

- Use `Link` for ordinary navigation.
- Use router APIs for command-flow side effects such as mutation success, guarded redirects, or form submission.
- Keep shareable navigation state in the URL rather than hidden component state.

## Runtime Cost

- Move changing state to the smallest consumer before considering memoization. Stable parent content can be lifted and passed as children.
- Avoid `memo`, `useMemo`, and `useCallback` unless identity or computation has a demonstrated consumer or measurable cost.
- Start independent remote work together and await it near the branch that consumes it. Avoid introducing request waterfalls.
- Load heavy optional surfaces on demand when they sit behind a dialog, tab, command, or feature activation.
- Use narrow selectors or field-level atoms for broad stores and subscriptions. Do not optimize simple primitive expressions merely for stylistic consistency.
