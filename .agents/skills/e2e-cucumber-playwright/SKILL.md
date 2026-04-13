---
name: e2e-cucumber-playwright
description: Write, update, or review Dify end-to-end tests under `e2e/` that use Cucumber, Gherkin, and Playwright. Use when the task involves `.feature` files, `features/step-definitions/`, `features/support/`, `DifyWorld`, scenario tags, locator/assertion choices, or E2E testing best practices for this repository.
---

# Dify E2E Cucumber + Playwright

## Overview

Use this skill for Dify's repository-level E2E suite in `e2e/`. Keep Dify's local architecture as the source of truth, and use Playwright/Cucumber best practices to guide authoring and review without introducing patterns that do not fit the current suite.

## Scope Guardrails

- Use this skill for `.feature` files, Cucumber step definitions, `DifyWorld`, hooks, tags, and E2E review work under `e2e/`.
- Do not use this skill for Vitest or React Testing Library work under `web/`; use `frontend-testing` instead.
- Do not use this skill for backend test or API review tasks under `api/`.

## Read Order

1. Read [`e2e/AGENTS.md`](../../../e2e/AGENTS.md) first.
2. Read only the files directly involved in the task:
   - target `.feature` files under `e2e/features/`
   - related step files under `e2e/features/step-definitions/`
   - `e2e/features/support/hooks.ts` and `e2e/features/support/world.ts` when session lifecycle or shared state matters
   - `e2e/scripts/run-cucumber.ts` and `e2e/cucumber.config.ts` when tags or execution flow matter
3. Read [`references/playwright-best-practices.md`](references/playwright-best-practices.md) when locator, assertion, isolation, or waiting choices are involved.
4. Read [`references/cucumber-best-practices.md`](references/cucumber-best-practices.md) when scenario wording, step granularity, tags, or expression design are involved.
5. Before changing configuration or introducing a new Playwright/Cucumber pattern, re-check the official docs with Context7.

## Repository Anchors

Treat these repository facts as hard constraints unless the user explicitly asks to change the suite architecture:

- `e2e/` uses Cucumber for scenarios and Playwright as the browser layer.
- `DifyWorld` is the per-scenario context object. Type `this` as `DifyWorld` in step definitions and use `async function`, not arrow functions.
- The suite currently organizes glue by capability under `e2e/features/step-definitions/`, with `common/` for shared steps.
- Browser session behavior is controlled in `features/support/hooks.ts`.
  - default: authenticated session with shared storage state
  - `@unauthenticated`: clean browser context
  - `@authenticated`: readability/selective-run tag only unless implementation changes
- `@fresh` scenarios only belong to `e2e:full*` flows; default runs exclude `@fresh`.
- Local verification should prefer `pnpm -C e2e check`, plus the narrowest E2E run that proves the change.

Do not import patterns from Playwright Test runner docs that bypass the current Cucumber + `DifyWorld` architecture unless the task is explicitly about changing that architecture.

## Authoring Workflow

### 1. Rebuild local context

- Inspect the target feature area in `e2e/features/`.
- Reuse an existing step when wording and behavior already match.
- Add a new step only when the scenario needs a genuinely new user action or assertion.
- Keep edits close to the existing capability folder unless the step is broadly reusable.

### 2. Write behavior-first scenarios

- Express user-observable behavior, not DOM mechanics or implementation details.
- Keep each scenario focused on one workflow or outcome.
- Prefer concrete examples over abstract coverage prose.
- Keep scenarios independent and re-runnable. Do not rely on execution order or state created by another scenario unless the suite explicitly resets and bootstraps that state.

### 3. Write step definitions that fit this suite

- Use `DifyWorld` for page/session access and in-scenario state.
- Keep one step to one user-visible action or one assertion.
- Prefer Cucumber Expressions for parameters such as `{string}` and `{int}`.
- Scope locators to stable containers when the page has repeated elements.
- Avoid inventing page-object layers or helper abstractions unless repeated complexity clearly justifies them and the change still matches the current repository style.

### 4. Apply Playwright best practices in the local shape

- Prefer user-facing locators:
  - `getByRole`
  - `getByLabel`
  - `getByPlaceholder`
  - `getByText`
  - `getByTestId` when an explicit contract is needed
- Use Playwright `expect(...)` web-first assertions.
- Do not use `waitForTimeout` for synchronization.
- Avoid manual polling or raw visibility checks when an auto-waiting assertion or locator action expresses the same behavior.

### 5. Validate narrowly, then broadly

- Run the narrowest tagged scenario or flow that exercises the change.
- Run `pnpm -C e2e check`.
- If the change affects hooks, tags, setup, or shared step semantics, broaden verification enough to cover the impacted area.

## Review Workflow

When reviewing E2E changes, prioritize these questions:

1. Does the scenario describe behavior rather than implementation?
2. Does it fit the current `e2e/` session model, tags, and `DifyWorld` usage?
3. Does it duplicate an existing step that should be reused instead?
4. Are locators resilient and user-facing?
5. Are assertions web-first and free of manual waits?
6. Does the change create hidden coupling across scenarios, tags, or instance state?
7. Does it accidentally document or implement behavior that differs from the real hooks/configuration?

Lead review findings with correctness, flake risk, and architecture drift. Treat style-only feedback as secondary.

## When To Re-check Official Docs

Use Context7 to refresh official guidance before changing:

- locator strategy or assertion style
- Cucumber Expressions or parameter typing
- hooks/config/session lifecycle patterns
- retries, waiting, or failure diagnostics
- any new Playwright/Cucumber capability not already present in `e2e/`

## References

- [`references/playwright-best-practices.md`](references/playwright-best-practices.md)
- [`references/cucumber-best-practices.md`](references/cucumber-best-practices.md)
