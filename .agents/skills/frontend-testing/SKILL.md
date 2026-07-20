---
name: frontend-testing
description: Write, update, or review Dify frontend tests using Vitest and Testing Library. Trigger for frontend specs, test coverage requests, regressions, testability, or testing strategy under web/ or packages/dify-ui/.
---

# Dify Frontend Testing

Use this skill for Vitest work under `web/` and `packages/dify-ui/`. Do not use it for Python tests or Cucumber/Playwright tests under `e2e/`.

## Required Source

Before writing, changing, or reviewing frontend tests, read `web/docs/test.md` completely. It is the single source of truth. This skill defines the execution workflow and must not add requirements that conflict with or duplicate that guide.

## Workflow

1. Read the source, its behavior owner, nearby specs, and relevant public dependencies.
1. Identify whether the contract belongs in `web/`, Dify UI Browser Mode, or a styled Storybook test.
1. Apply the canonical guide to decide whether a test is needed and choose its boundary.
1. For a behavior change or bug fix, write or identify the failing scenario first when practical.
1. Implement one coherent scenario at a time and run the focused spec before expanding scope.
1. Finish with the affected suite and relevant repository checks.
1. Report what behavior was verified and any risk that still requires browser, visual, or end-to-end validation.

When reviewing existing tests, recommend deleting low-value tests as readily as adding missing behavior coverage.

Run focused tests from the owning workspace:

```bash
# web/
vp test run path/to/spec-or-directory

# packages/dify-ui/
vp test run --project unit src/path/to/spec
```

For styled Dify UI behavior, run `vp test --project storybook --run`. Run broader checks only after the focused behavior passes.
