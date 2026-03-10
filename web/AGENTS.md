## Frontend Workflow

- Refer to the `./docs/test.md` and `./docs/lint.md` for detailed frontend workflow instructions.

## Overlay Components (Mandatory)

- `./docs/overlay-migration.md` is the source of truth for overlay-related work.
- In new or modified code, use only overlay primitives from `@/app/components/base/ui/*`.
- Do not introduce deprecated overlay imports from `@/app/components/base/*`; when touching legacy callers, prefer migrating them and keep the allowlist shrinking (never expanding).

## Automated Test Generation

- Use `./docs/test.md` as the canonical instruction set for generating frontend automated tests.
- When proposing or saving tests, re-read that document and follow every requirement.
- All frontend tests MUST also comply with the `frontend-testing` skill. Treat the skill as a mandatory constraint, not optional guidance.
