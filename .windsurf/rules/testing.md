# Windsurf Testing Rules

- Use `web/testing/testing.md` as the single source of truth for frontend automated testing.
- Honor every requirement in that document when generating or accepting tests.
- When proposing or saving tests, re-read that document and follow every requirement.

## Key Rules Summary

### Path-Level Testing

- When testing a directory/path, test **ALL files** in that path (not just index)
- Can use single spec file (integration) or multiple spec files (unit)
- Goal: 100% coverage of directory contents

### Integration Testing First

- **DO NOT mock base components** (`@/app/components/base/*` like Loading, Button, Tooltip)
- Import real project components instead of mocking
- Only mock: API services, complex context providers, third-party libs with side effects

### Black-Box Assertions

- Prefer role-based queries (`getByRole`) over text queries
- Use pattern matching (`/text/i`) instead of hardcoded strings
- Test observable behavior, not implementation details
