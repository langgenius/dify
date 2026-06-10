## Frontend Workflow

- Refer to the `./docs/test.md` and `./docs/lint.md` for detailed frontend workflow instructions.
- For frontend coding tasks, also apply the repo-local `how-to-write-component` skill when the change touches React components, state ownership, routing, styling, or Tailwind classes.
- For frontend reviews, use the repo-local `frontend-code-review` skill as the canonical checklist.

## i18n

- User-facing strings must use `web/i18n/en-US/` keys instead of hardcoded text.
- When adding or renaming an i18n key, update all supported locale files with correct localized values. Do not leave fallback English in non-English locales unless the repo already intentionally does so for that exact key.

## Overlay Components (Mandatory)

- `../packages/dify-ui/README.md` is the permanent contract for overlay primitives, portals, root `isolation: isolate`, and the `z-50` / `z-60` layering.
- `./docs/overlay.md` records the current web overlay best practices.
- In new or modified code, use only overlay primitives from `@langgenius/dify-ui/*`.
- Do not introduce overlay imports from `@/app/components/base/*`; when touching existing callers, migrate them.

## SVG Icons (Mandatory)

- New custom SVG icons must be added under `../packages/iconify-collections/assets/...`.
- Run `pnpm --filter @dify/iconify-collections generate` and consume generated icons with Tailwind `i-custom-*` classes.
- Restart the web dev server after regenerating icons because Tailwind loads the custom icon collection at startup.
- Do not add new generated React icon components or JSON files under `app/components/base/icons/src/...`.
- See `../packages/iconify-collections/README.md` for the full workflow.

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
