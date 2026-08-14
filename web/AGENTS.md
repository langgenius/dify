## Frontend Workflow

- Read `docs/test.md` only for frontend test work and `docs/lint.md` only when running or changing static checks.
- Use the repo-local `how-to-write-component` skill when implementation requires component ownership, state, data-flow, effect, or interaction-boundary decisions. Do not load it for test-only, copy-only, or styling-only changes.
- Use `frontend-code-review` only for explicit frontend review or audit requests, including test reviews. Use `frontend-testing` when writing or changing Vitest or React Testing Library tests.

## Package Contracts

- User-facing strings must use `web/i18n/en-US/` keys. When adding or renaming a key, update every supported locale with the correct localized value.
- For new backend calls and migrated surfaces, use generated `consoleQuery` / `consoleClient` APIs from `@/service/client`. Do not add handwritten REST helpers or DTO mirrors, mock-backed app state, or direct edits to generated contracts.
- Prefer `@langgenius/dify-ui/*` primitives, data attributes, and design tokens. Preserve a visible focus indicator on the final focusable element.
- Use `Button` for actions with visible text and `IconButton` for icon-only actions. Every `IconButton` needs an `aria-label` or `aria-labelledby`; compose Menu, Popover, Toggle, and Collapsible through `render` so those primitives keep ownership of their state.
- Follow `docs/overlay.md` for overlay selection and migration. Migrate a legacy overlay only when the current behavior change actually involves that overlay boundary.
- For custom SVG icons, follow `../packages/iconify-collections/README.md`; do not add generated React icons under `app/components/base/icons/src/`.
- `docs/test.md` is the single source of truth for frontend automated-test policy. Skills may route and execute that policy but must not redefine it.
