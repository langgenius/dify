## Frontend Workflow

- Refer to the `./docs/test.md` and `./docs/lint.md` for detailed frontend workflow instructions.

## Overlay Components (Mandatory)

- `../packages/dify-ui/README.md` is the permanent contract for overlay primitives, portals, root `isolation: isolate`, and the `z-50` / `z-60` layering.
- `./docs/overlay.md` records the current web overlay best practices.
- In new or modified code, use only overlay primitives from `@langgenius/dify-ui/*`.
- Do not introduce overlay imports from `@/app/components/base/*`; when touching existing callers, migrate them.

## Design Token Mapping

- When translating Figma designs to code, read `../packages/dify-ui/AGENTS.md` for the Figma `--radius/*` token to Tailwind `rounded-*` class mapping. The two scales are offset by one step.

## Automated Test Generation

- Use `./docs/test.md` as the canonical instruction set for generating frontend automated tests.
- When proposing or saving tests, re-read that document and follow every requirement.
- All frontend tests MUST also comply with the `frontend-testing` skill. Treat the skill as a mandatory constraint, not optional guidance.
