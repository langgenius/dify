## Frontend Workflow

- Read `docs/test.md` only for frontend test work and `docs/lint.md` only when running or changing static checks.
- Use the repo-local `how-to-write-component` skill when implementation requires component ownership, state, data-flow, effect, or interaction-boundary decisions. Do not load it for test-only, copy-only, or styling-only changes.
- Use `frontend-code-review` only for explicit frontend review or audit requests, including test reviews. Use `frontend-testing` when writing or changing Vitest or React Testing Library tests.

## Package Contracts

- User-facing strings must use `web/i18n/en-US/` keys. When adding or renaming a key, update every supported locale with the correct localized value.
- For new backend calls and migrated surfaces, use generated `consoleQuery` / `consoleClient` APIs from `@/service/client`. Do not add handwritten REST helpers or DTO mirrors, mock-backed app state, or direct edits to generated contracts.
- Prefer `@langgenius/dify-ui/*` primitives, data attributes, and design tokens. Start from the [Dify UI package index] when choosing a primitive or shared contract. Preserve a visible focus indicator on the final focusable element.
- Reuse the Web `SearchInput` composite when its search, clear, and IME contract matches the feature; otherwise follow the canonical [Input Group contract].
- Give save and submit flows a real form boundary with visible labels and accessible errors. Use Dify UI `Form` when its structured submission and validation contract is the owner; otherwise use a native form. Follow the canonical [form contract].
- Follow the canonical [Button contract] and [IconButton contract] for action semantics, loading, accessible names, and primitive composition. Do not add a Web wrapper that hides those contracts.
- Follow the [Dify UI overlay contract] for primitive selection, portals, focus, and layering. Reuse the Web `Infotip` composite for an info glyph that opens explanatory content. Do not introduce a generic Web wrapper that recreates Dify UI overlay behavior.
- For custom SVG icons, follow `../packages/iconify-collections/README.md`; do not add generated React icons under `app/components/base/icons/src/`.
- `docs/test.md` is the single source of truth for Web automated-test policy. Skills may route and execute that policy but must not redefine it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

[Button contract]: ../packages/dify-ui/src/button/README.md
[Dify UI overlay contract]: ../packages/dify-ui/docs/overlays.md
[Dify UI package index]: ../packages/dify-ui/README.md
[IconButton contract]: ../packages/dify-ui/src/icon-button/README.md
[Input Group contract]: ../packages/dify-ui/src/input-group/README.md
[form contract]: ../packages/dify-ui/docs/forms.md
