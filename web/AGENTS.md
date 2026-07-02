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
- For shared low-frequency, client-only persistence such as user preferences, dismissed notices, and UI defaults, use feature-owned storage modules built with `createLocalStorageState`.
- For high-frequency interactions, update the feature state during interaction and persist storage only on commit or settled updates.
- Keep storage keys and raw/custom formats in the owner module; callers should import the named storage hooks instead of scattering direct storage access.
- Do not add ad hoc global event listeners for shared state. Prefer atoms, existing stores, or a shared subscription hook so listeners are centralized and deduplicated.

## Agent V2 Frontend

- Keep Agent V2 separate from legacy workflow Agent. Use `web/features/agent-v2`, `web/app/components/workflow/nodes/agent-v2`, the `agent_node_kind: 'dify_agent'` and `version: '2'` payload discriminator, and `BlockEnum.AgentV2` where the graph type is already migrated. Do not bridge Agent V2 to legacy `agent_strategy_*` behavior or data shapes.
- Use generated contracts and `consoleQuery` / `consoleClient` from `@/service/client` for Agent V2 backend calls. Do not add handwritten REST helpers, handwritten API types, mock-backed app state, or direct edits to generated contract files.
- Treat TanStack Query as the server source of truth. Scope editable drafts with an instance-level `AgentComposerProvider`, hydrate Jotai `originalDraft`, `publishedDraft`, and `draft` from contract data, and compute dirty or unpublished state from those draft snapshots.
- Keep transitional defaults and mock data at the owning surface, such as the configure page or workflow node, not in shared composer defaults.
- Use `@langgenius/dify-ui/*` primitives and primitive data/CSS selectors first. Add call-site Tailwind only for real design deltas, avoid arbitrary values when token utilities exist, and keep focus rings visible without making inert layout regions focusable.
- Keep Agent V2 copy in the `agentV2` i18n namespace, currently backed by `agent-v-2.json` in the maintained locale set.

## Automated Test Generation

- Use `./docs/test.md` as the canonical instruction set for generating frontend automated tests.
- When proposing or saving tests, re-read that document and follow every requirement.
- All frontend tests MUST also comply with the `frontend-testing` skill. Treat the skill as a mandatory constraint, not optional guidance.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

**Keep this block, including in commits.** It is part of the project's agent setup, maintained by `next dev` for every agent that works here. If it appears as an uncommitted change, that is intentional — commit it as-is. Do not remove it to clean up a diff; it will be regenerated.

<!-- END:nextjs-agent-rules -->
