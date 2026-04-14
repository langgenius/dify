# Playwright Best Practices For Dify E2E

Use this reference when writing or reviewing locator, assertion, isolation, or synchronization logic for Dify's Cucumber-based E2E suite.

Official sources:

- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/test-assertions
- https://playwright.dev/docs/browser-contexts

## What Matters Most

### 1. Keep scenarios isolated

Playwright's model is built around clean browser contexts so one test does not leak into another. In Dify's suite, that principle maps to per-scenario session setup in `features/support/hooks.ts` and `DifyWorld`.

Apply it like this:

- do not depend on another scenario having run first
- do not persist ad hoc scenario state outside `DifyWorld`
- do not couple ordinary scenarios to `@fresh` behavior
- when a flow needs special auth/session semantics, express that through the existing tag model or explicit hook changes

### 2. Prefer user-facing locators

Playwright recommends built-in locators that reflect what users perceive on the page.

Preferred order in this repository:

1. `getByRole`
2. `getByLabel`
3. `getByPlaceholder`
4. `getByText`
5. `getByTestId` when an explicit test contract is the most stable option

Avoid raw CSS/XPath selectors unless no stable user-facing contract exists and adding one is not practical.

Also remember:

- repeated content usually needs scoping to a stable container
- exact text matching is often too brittle when role/name or label already exists
- `getByTestId` is acceptable when semantics are weak but the contract is intentional

### 3. Use web-first assertions

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

### 4. Let actions wait for actionability

Locator actions already wait for the element to be actionable. Do not preface every click/fill with extra timing logic unless the action needs a specific visible/ready assertion for clarity.

Good pattern:

- assert a meaningful visible state when that is part of the behavior
- then click/fill/select via locator APIs

Bad pattern:

- stack arbitrary waits before every action
- wait on unstable implementation details instead of the visible state the user cares about

### 5. Match debugging to the current suite

Playwright's wider ecosystem supports traces and rich debugging tools. Dify's current suite already captures:

- full-page screenshots
- page HTML
- console errors
- page errors

Use the existing artifact flow by default. If a task is specifically about improving diagnostics, confirm the change fits the current Cucumber architecture before importing broader Playwright tooling.

## Review Questions

- Would this locator survive DOM refactors that do not change user-visible behavior?
- Is this assertion using Playwright's retrying semantics?
- Is any explicit wait masking a real readiness problem?
- Does this code preserve per-scenario isolation?
- Is a new abstraction really needed, or does it bypass the existing `DifyWorld` + step-definition model?
