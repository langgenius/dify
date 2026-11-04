---
name: frontend-testing
description: Use when writing or changing Vitest or React Testing Library tests under `web/` or `packages/dify-ui/`, or when the user explicitly requests frontend test strategy, including evaluation of an existing strategy. Do not use for frontend code-review-only requests, general testability discussion, Python tests, or Cucumber/Playwright E2E.
---

# Frontend Testing

Read the testing policy for the package that owns the changed tests:

- `web/`: `web/docs/test.md` owns Web test boundaries, environments, and commands.
- `packages/dify-ui/`: `packages/dify-ui/docs/testing.md` owns primitive test boundaries, environments, Storybook, and commands.

This skill adds no parallel policy or check sequence. Follow the selected owner's requirements, including its validation commands. Recommend deleting low-value tests as readily as adding missing behavior coverage, and report the contract verified and any material verification gap.
