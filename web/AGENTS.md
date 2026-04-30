## Frontend Workflow

- Refer to the `./docs/test.md` and `./docs/lint.md` for detailed frontend workflow instructions.

## Overlay Components (Mandatory)

- `../packages/dify-ui/README.md` is the permanent contract for overlay primitives, portals, root `isolation: isolate`, and the `z-1002` / `z-1003` layering.
- `./docs/overlay-migration.md` is the source of truth for the ongoing migration (deprecated import paths and coexistence rules).
- In new or modified code, use only overlay primitives from `@langgenius/dify-ui/*`.
- Do not introduce deprecated overlay imports from `@/app/components/base/*`; when touching legacy callers, prefer migrating them.

## Query & Mutation (Mandatory)

- `frontend-query-mutation` is the source of truth for Dify frontend contracts, query and mutation call-site patterns, conditional queries, invalidation, and mutation error handling.

## Design Token Mapping

- When translating Figma designs to code, read `../packages/dify-ui/AGENTS.md` for the Figma `--radius/*` token to Tailwind `rounded-*` class mapping. The two scales are offset by one step.

## Automated Test Generation

- Use `./docs/test.md` as the canonical instruction set for generating frontend automated tests.
- When proposing or saving tests, re-read that document and follow every requirement.
- All frontend tests MUST also comply with the `frontend-testing` skill. Treat the skill as a mandatory constraint, not optional guidance.
