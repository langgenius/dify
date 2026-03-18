# Next Link Compat Layer Design

## Goal

Route all `web` usage of `next/link` through a project-owned compatibility layer so future Next migration work can be scoped through one import boundary.

## Scope

- Add a thin wrapper at `web/next/link.ts`
- Migrate all existing `next/link` imports in production code and tests to `@/next/link`
- Extend ESLint restricted-import rules to block new direct `next/link` imports outside `web/next/*`

## Non-goals

- No runtime behavior changes
- No project-specific navigation logic
- No external-link policy changes
- No `Link` prop reshaping or custom typing

## Design

### Wrapper

Follow the existing compat pattern used by `web/next/dynamic.ts` and similar files. The wrapper remains a single-line re-export:

```ts
export { default } from 'next/link'
```

This keeps the business dependency direction as `business -> @/next/link -> next/link` without altering behavior.

### Call-site migration

Replace all direct `next/link` imports in `web` with `@/next/link`, including tests and mocks. Keep all current props and JSX usage unchanged.

### Lint enforcement

Add `next/link` to the restricted import patterns in `web/eslint.config.mjs`, matching the current compat-layer enforcement style for other migrated Next modules.

## Validation

- Run ESLint on changed files
- Run `pnpm type-check:tsgo`
- Ensure representative tests and mocks still resolve through `@/next/link`

## Why this is worth doing

This is a low-risk migration seam. It does not reduce today’s code changes, but it centralizes tomorrow’s framework changes behind one project-owned import path.
