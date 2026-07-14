---
name: frontend-testing
description: Write, update, or review Dify frontend tests using Vitest and React Testing Library. Trigger for frontend specs, test coverage requests, regressions, testability, or testing strategy under web/.
---

# Dify Frontend Testing

Use this skill for Vitest and React Testing Library work under `web/`. Do not use it for Python tests or Cucumber/Playwright tests under `e2e/`.

## Required Source

Before writing, changing, or reviewing frontend tests, read `web/docs/test.md` completely. It is the single source of truth. This skill defines the execution workflow and must not add requirements that conflict with or duplicate that guide.

## Workflow

1. Read the source, its behavior owner, nearby specs, and relevant public dependencies.
1. Apply the canonical guide to decide whether a test is needed and choose its boundary.
1. For a behavior change or bug fix, write or identify the failing scenario first when practical.
1. Implement one coherent scenario at a time and run the focused spec before expanding scope.
1. Finish with the affected suite and relevant repository checks.
1. Report what behavior was verified and any risk that still requires browser, visual, or end-to-end validation.

When reviewing existing tests, recommend deleting low-value tests as readily as adding missing behavior coverage.

Run focused tests from `web/`:

```bash
vp test run path/to/spec-or-directory
```

Run broader checks only after the focused behavior passes.
