---
name: e2e-cucumber-playwright
description: Use when writing, changing, or reviewing Cucumber and Playwright tests under `e2e/`, including feature files, step definitions, support code, scenario tags, locators, and assertions. Do not use for Vitest, React Testing Library, backend tests, or generic browser automation outside the E2E suite.
---

# E2E Cucumber And Playwright

`e2e/AGENTS.md` owns the suite architecture, lifecycle, commands, tags, generated-client boundaries, fixtures, and cleanup contracts. Read the nearest feature-scoped `AGENTS.md` when one exists. This skill adds no parallel package policy.

## Topic Routing

Read only the bundled reference required by the change:

- Locator, assertion, isolation, or waiting decisions: [`references/playwright-best-practices.md`][playwright]
- Scenario wording, step granularity, expressions, or tag design: [`references/cucumber-best-practices.md`][cucumber]

Check current official Playwright or Cucumber documentation before introducing a framework pattern that local code and references do not already establish.

## Workflow

1. Add E2E coverage only for a critical user journey with a cross-boundary outcome that cheaper owner-level tests do not already prove.
2. Identify the user-visible behavior and its feature owner. Start from real product defaults and actor roles; setup may establish preconditions but must not manufacture the opposite state to make the scenario meaningful.
3. Read the target scenario, matching step definitions, and lifecycle files only when session or shared state matters.
4. Reuse an existing step when wording and behavior match; add one coherent scenario or step when they do not.
5. Keep browser actions and assertions at the public user boundary; keep setup, seed, polling, and cleanup at their package-defined owners.
6. Run the narrowest tagged scenario and package checks documented in `e2e/AGENTS.md`; broaden only for shared hooks, tags, or support changes.

For review requests, lead with reproducible correctness failures, flake sources, or demonstrated architecture drift. Report the behavior verified and any external-runtime, browser, or environment gap.

[cucumber]: references/cucumber-best-practices.md
[playwright]: references/playwright-best-practices.md
