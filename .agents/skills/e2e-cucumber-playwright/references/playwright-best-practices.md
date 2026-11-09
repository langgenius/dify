# Playwright Best Practices

Use this reference when writing or reviewing locator, assertion, isolation, or synchronization logic.

Official sources:

- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/actionability
- https://playwright.dev/docs/test-assertions
- https://playwright.dev/docs/test-timeouts
- https://playwright.dev/docs/browser-contexts
- https://playwright.dev/docs/events
- https://playwright.dev/docs/trace-viewer

## What Matters Most

### 1. Keep scenarios isolated

Playwright's model is built around clean browser contexts so one test does not leak into another.

Apply it like this:

- do not depend on another scenario having run first
- keep scenario state in the runner's scenario-owned context rather than module globals
- model special authentication or session setup through explicit per-scenario fixtures rather than shared mutable state

### 2. Select locators by user contract

Prefer built-in locators that match how the target is exposed to users:

- interactive controls: role and accessible name
- form controls: associated label; use placeholder when it is the relevant stable contract, especially when no label exists
- non-interactive content: visible text or the relevant text alternative
- elements without a meaningful user-facing contract: an intentional test id

This is a semantic choice, not a fixed ranking. Do not add incorrect roles or accessible names solely to satisfy a locator. When the product element should have user-facing semantics, fix that contract instead.

Avoid raw CSS/XPath selectors unless no stable user-facing contract exists and adding one is not practical.

Locators are strict for single-element actions. Scope to a stable region or use `filter({ has, hasText })` to make the intended target unique. Treat `.first()`, `.last()`, or `.nth()` as a review signal: the positional choice should be intentional and stable, not merely silence ambiguity.

### 3. Use web-first assertions with the right timeout owner

Playwright assertions auto-wait and retry. Prefer them over manual state inspection.

Prefer:

- `await expect(page).toHaveURL(...)`
- `await expect(locator).toBeVisible()`
- `await expect(locator).toBeHidden()`
- `await expect(locator).toBeEnabled()`
- `await expect(locator).toHaveText(...)`

Avoid:

- `expect(await locator.isVisible()).toBe(true)`
- custom polling loops for DOM state
- `waitForTimeout` as synchronization

If a condition genuinely needs custom retry logic, use Playwright's polling/assertion tools deliberately and keep that choice local and explicit.

Use `expect.poll` for non-DOM truth such as API state, backend eventual consistency, generated resources, or captured browser events. For DOM state, use locator assertions so Playwright can apply actionability and web-first retry semantics.

Cucumber step and hook timeouts, Playwright locator/action timeouts, and Playwright assertion timeouts are separate budgets. `browserContext.setDefaultTimeout()` does not change the default five-second assertion timeout. Put an explicit longer assertion timeout only on the readiness owner that needs it; do not raise an outer timeout to mask a shorter inner failure.

### 4. Let actions wait for actionability

Locator actions already wait for the element to be actionable. Do not preface every click/fill with extra timing logic unless the action needs a specific visible/ready assertion for clarity.

Good pattern:

- assert a meaningful visible state when that is part of the behavior
- then click/fill/select via locator APIs

Bad pattern:

- stack arbitrary waits before every action
- wait on unstable implementation details instead of the visible state the user cares about
- use `force: true` to bypass a real hit-target, overlay, or disabled-state failure

When synchronizing on a one-shot popup, download, request, or response, create the wait before triggering the action, then await the event. A scenario-owned listener may instead capture events for a later assertion. Do not use `networkidle` as an application-readiness assertion; wait for the user-visible state or owned backend contract.

### 5. Match debugging to the active harness

Playwright supports traces, screenshots, page snapshots, and browser logs. Configure artifact capture in Cucumber hooks instead of adding parallel diagnostics to individual scenarios. If tracing is introduced, use `browserContext.tracing`; Playwright Test options such as `trace: 'on-first-retry'`, projects, workers, fixtures, reporters, and retries do not configure this harness.

## Review Questions

- Would this locator survive DOM refactors that do not change user-visible behavior?
- Is a positional locator expressing product order, or hiding an ambiguous match?
- Is this assertion using Playwright's retrying semantics?
- Does an explicit timeout belong to the condition that is actually slow?
- Was an event wait registered before the action that emits it?
- Does this code preserve per-scenario isolation?
- Is a new abstraction really needed, or does it bypass the runner's scenario-owned context and lifecycle?
