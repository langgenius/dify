---
name: frontend-testing
description: Use when writing, changing, or reviewing Vitest or React Testing Library tests under `web/` or `packages/dify-ui/`, or when the user explicitly requests frontend test strategy. Do not use for general testability discussion, Python tests, or Cucumber/Playwright E2E.
---

# Frontend Testing

`web/docs/test.md` is the single policy owner. Read it before changing or reviewing frontend tests; this skill adds no separate requirements.

1. Identify the observable contract and regression risk.
2. Choose the smallest boundary that includes the behavior owner.
3. Establish the failing case first when practical, then implement one coherent scenario.
4. Run the focused spec before the affected suite and relevant static checks.
5. Report the behavior verified and any remaining browser, visual, or end-to-end risk.

Recommend deleting low-value tests as readily as adding missing behavior coverage. Use the commands and environment boundaries documented in `web/docs/test.md` rather than copying them here.
