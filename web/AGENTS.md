## Frontend Workflow

- Refer to the `./docs/test.md` and `./docs/lint.md` for detailed frontend workflow instructions.

## Overlay Components (Mandatory)

- `../packages/dify-ui/README.md` is the permanent contract for overlay primitives, portals, root `isolation: isolate`, and the `z-50` / `z-60` layering.
- `./docs/overlay.md` records the current web overlay best practices.
- In new or modified code, use only overlay primitives from `@langgenius/dify-ui/*`.
- Do not introduce overlay imports from `@/app/components/base/*`; when touching existing callers, migrate them.

## Design Token Mapping

- When translating Figma designs to code, read `../packages/dify-ui/AGENTS.md` for the Figma `--radius/*` token to Tailwind `rounded-*` class mapping. The two scales are offset by one step.

## Client State Management

- Use local component state for state owned by one component.
- Use feature-level Jotai atoms for simple client state shared across components in the same feature, especially when components need a shared source of truth, derived values, or shared actions.
- Use existing feature stores for complex or high-frequency interaction state such as workflow canvas, drag, resize, and panel runtime state.
- Use `@/hooks/use-local-storage` only for low-frequency, client-only persistence such as user preferences, dismissed notices, and UI defaults. Do not use localStorage as the live source of truth for app state.
- For high-frequency interactions, update the feature state during interaction and persist storage only on commit or settled updates.
- Do not access `localStorage`, `window.localStorage`, or `globalThis.localStorage` directly in app code; use the storage hook boundary and preserve existing raw/custom storage formats.
- Do not add ad hoc global event listeners for shared state. Prefer atoms, existing stores, or a shared subscription hook so listeners are centralized and deduplicated.

## Automated Test Generation

- Use `./docs/test.md` as the canonical instruction set for generating frontend automated tests.
- When proposing or saving tests, re-read that document and follow every requirement.
- All frontend tests MUST also comply with the `frontend-testing` skill. Treat the skill as a mandatory constraint, not optional guidance.
