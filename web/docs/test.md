# Frontend Testing Guide

This document is the single source of truth for automated frontend tests under `web/`. Tests should protect product behavior and make refactoring safer. They are not a file-by-file completion exercise. Dify UI owns its package-specific test boundary in the [Dify UI testing contract].

## Testing Mindset

Write or update a test when a change affects a stable, observable contract:

- User interactions and resulting UI state.
- Navigation, URL state, persistence, permissions, or data flow.
- Loading, success, error, and empty states that users can actually reach.
- Accessibility semantics, keyboard behavior, focus management, or disabled state.
- Business logic or a reusable utility with meaningful input/output behavior.
- A bug fix whose regression can be reproduced through a public boundary.

Do not add tests merely for file/prop coverage, render-without-crashing checks, React implementation choices, or inputs excluded by TypeScript and the product contract.

Decide whether a regression needs lasting automated coverage before choosing its boundary or runtime. Check existing tests first. For visual-only changes, default to reviewing the real UI at representative widths and states; record the result without adding a permanent test. Automate a stable visual requirement or meaningful regression risk, not every design adjustment. Do not move a low-value test to another runner or a screenshot suite merely to keep coverage.

### Coverage

Coverage is a diagnostic signal, not a quality target. This guide defines no required percentage and reviewers should not request tests solely to increase coverage. Use a report to find suspicious gaps, then decide whether each gap represents a product risk worth protecting.

## Choose the Right Boundary

Use the smallest boundary that includes the behavior owner and proves the product contract without coupling the test to implementation:

- Test pure transformations and business rules as unit tests.
- Test hooks directly only when the hook itself exposes a reusable public contract. Otherwise, exercise the hook through its owning component or feature.
- Use React Testing Library for component and feature behavior visible through the DOM or external side effects.
- Use integration tests for behavior that crosses meaningful module boundaries.
- Use the `browser` project when it adds meaningful browser evidence under [Browser Mode Admission].
- Follow the [Dify UI testing contract] for the Storybook and Vitest boundary of Dify UI primitives.

Test the behavior owner. Barrel exports, pass-through wrappers, and purely presentational children do not need separate tests when the owning feature already proves their contract. Do not repeat generic behavior already owned by Base UI, React Aria, or the browser; test Dify's integration, overrides, and known regressions.

### Browser Mode Admission

Web defaults to the `unit` project in `happy-dom`. This is a project tradeoff, not a Vitest restriction: [Vitest component testing] recommends Browser Mode, and [Vitest visual regression testing] supports visual contracts.

A new browser test must establish all three:

- **Value:** name the user-visible failure or stable visual requirement worth protecting. Layout, focus, portals, observers, and “happy-dom cannot do this” alone are not justification.
- **Additional evidence:** identify what existing owner tests miss and what real rendering or browser interaction adds. Do not repeat a state matrix just because a browser fixture exists.
- **Faithful boundary:** exercise the production owner and assert the claimed result. A copied layout cannot prove page integration; cursor or hover styling cannot prove that clicking performs an action.

Use the smallest scenario that supplies that evidence. Native selection, focus restoration to CSS-hidden controls, hit testing, scrolling, and animation completion can justify browser coverage. Ordinary event handling and DOM state usually belong in `unit`. Synthetic events can test handler responses but do not prove native gesture generation, capture, or event ordering; use the [Vitest Interactivity API] when those are the contract.

Do not add permanent tests solely to freeze decorative spacing, radii, or artwork dimensions from a one-off visual adjustment. Geometry and computed styles are appropriate when they prove the chosen contract, such as readable content, unobstructed controls, or visible keyboard focus. Visual baselines need an explicit stable requirement and controlled rendering environment.

Each `*.browser.spec.{ts,tsx}` must make its regression and additional evidence clear from its scenario and assertions; add a short explanation only when needed. Do not use forced interaction, fixed sleeps, private DOM assertions, or real network requests.

Browser Mode remains a focused component or feature test and currently proves Chromium only. Use the end-to-end suite for a running application, authentication, real routing, backend APIs, persistence, or complete journeys.

## Assert Behavior, Not Implementation

- Drive state transitions through props, user interaction, URL changes, or public APIs.
- Assert rendered UI, ARIA state, navigation, persistence, network-boundary calls, or another observable result.
- For a reset-or-persistence regression in a hidden surface, exercise the public transition: open, modify, close and wait for the surface to disappear, then reopen. Assert the intended behavior without coupling the test to hook placement, component names, keys, or private mount structure.
- Do not inspect React state, refs, hook call order, effect dependencies, or private DOM structure.
- Test referential identity only when identity is itself a documented public contract.
- One test should describe one behavior. It may contain multiple assertions when they jointly prove that behavior.
- Test only input states supported by the type and product contract. Do not manufacture `null`, `undefined`, or extreme values without a reachable scenario.
- Do not assert CSS class names or mechanically translate them into computed-style assertions. Assert the required outcome; use visual review for incidental styling.
- Use DOM or data snapshots only when serialized output is itself an intentionally public, stable contract. Visual baselines follow Browser Mode Admission.

## Queries, Interaction, and Accessibility

Prefer selectors in this order:

1. `getByRole` with an accessible name.
1. `getByLabelText` for labeled form controls.
1. `getByText`, `getByPlaceholderText`, or other user-visible queries when appropriate.
1. `getByTestId` only for boundaries with no useful DOM semantics, such as canvas output, editor shims, or mocked non-visual integrations.

When repeated content creates ambiguity, narrow to a semantic container, then query within it with `within` in React Testing Library or locator chaining in Browser Mode.

If an interactive control cannot be found semantically, first check whether the production markup needs a real button, link, label, landmark, or accessible name.

- In React Testing Library tests, use a `userEvent.setup()` instance inside the test. Use `fireEvent` only when the low-level event itself is the contract.
- In Browser Mode, interact through awaited locators. Use `.element()` only for DOM APIs that locators do not expose.
- Semantic queries and automated checks do not constitute complete accessibility conformance.
- Exact copy assertions are valid when the copy or translation key is the contract; otherwise prefer a semantic query or resilient match.
- In React Testing Library, use `queryBy*` for synchronous absence, `findBy*` for asynchronous appearance, and `waitForElementToBeRemoved` or `waitFor` for asynchronous disappearance. In Browser Mode, use `expect.element` for eventual assertions.

## Mock at Real Boundaries

Keep the production code that owns or transforms the asserted behavior real. Mock only dependencies outside the target contract, where isolation improves the signal:

- Service and network boundaries.
- Next.js navigation or browser APIs not provided by the test environment.
- External SDKs and expensive providers.
- Independently tested child boundaries that do not own or transform the asserted behavior and whose setup would otherwise dominate the owner test.

Mocks must preserve the public contract needed by the test. Do not mock interactive Dify UI primitives or feature-owned wrappers around them. Keep their semantic roles, state attributes, portals, focus behavior, and `render(props, state)` contract real; mock only service or external-data boundaries needed to reach the scenario.

- Never make real network requests.
- Reset shared mock state before each test that mutates it.
- Create a fresh TanStack Query client for tests that exercise query behavior.
- Prefer typed builders with valid defaults for complex data. Add overrides only for fields relevant to the scenario.
- Keep local mocks local. Move a mock helper to `web/__mocks__/` only when multiple suites genuinely share it.

## Async, Time, and Isolation

- Await user interactions, promises, `findBy*`, and `waitFor`.
- Wait for observable state changes. Do not use fixed sleeps or broad retries to hide incorrect timing.
- Use fake timers only when timer behavior is part of the contract. Restore real timers after the test.
- Control time, randomness, network responses, and shared stores so tests are deterministic.
- `web/vitest.setup.ts` already runs Testing Library cleanup and resets Zustand stores after each test.
- Call `vi.clearAllMocks()` in `beforeEach` when a suite relies on mock call history. Do not use `afterEach` to prepare the next test.

## Dify Test Setup

- Following [Vite+ testing configuration], tests under `web/` use two explicit projects in `web/vite.config.ts`. Supported commands and CI select one project explicitly: `unit` runs in `happy-dom` and loads `web/vitest.setup.ts`, while `browser` runs matching `app/**/*.browser.spec.{ts,tsx}` files in Playwright Chromium and loads `web/vitest.browser.setup.ts`. Bare `vp test` runs both registered projects.
- Browser failures keep screenshots and Playwright traces under `web/.vitest-browser/`. CI uploads that directory only when failure artifacts exist; Browser Mode does not own coverage or report merging.
- New component and feature specs should generally use a sibling `__tests__/` directory. Existing colocated utility and hook specs may follow their owning module's convention. Cross-feature integration specs belong in `web/__tests__/`.
- The shared `react-i18next` mock is loaded globally. Use `createReactI18nextMock` from `web/test/i18n-mock` only when a test needs custom translations.
- For `nuqs` behavior, use the helpers in `web/test/nuqs-testing.tsx` and assert URL updates. Mock `nuqs` only when URL synchronization is explicitly outside the test contract.
- Do not add another test runner, DOM environment, or network interception library without a demonstrated project-level need.

## Workflow

Use the behavior owner and nearby tests to identify a realistic regression and the assertion that would catch it. For a behavior change or bug fix, establish the failing case first when practical. Remove redundant tests and assertions as readily as adding missing coverage.

Run the focused spec and the affected suite when it adds coverage beyond that spec, plus the required [static checks]. Once these pass, broaden or repeat verification only for new changes, failures, or unresolved concerns. Diagnose CI-only failures from the failing job and reproduce them locally when possible; reruns do not replace diagnosis or reporting.

## Commands

Run from `web/`:

```bash
# happy-dom; omit the path to run the full unit project
vp test run --project unit path/to/spec-or-directory

# Browser Mode; omit the path to run the full browser project
vp test run --project browser path/to/spec.browser.spec.tsx

# Watch mode; select browser instead for Browser Mode
vp test watch --project unit path/to/spec

# Diagnostic coverage report for the unit project; not an acceptance target
vp test run --project unit --coverage path/to/spec-or-directory
```

Always pass `--project unit` or `--project browser`. Bare `vp test` runs both registered projects and is not the standard Web test command.

## References

- [Vitest documentation]
- [Vitest test projects]
- [Why Browser Mode]
- [Vitest Browser Mode documentation]
- [Vitest Browser Mode locators]
- [Vitest Browser Mode traces]
- [Storybook Vitest addon]
- [Testing Library guiding principles]
- [React Testing Library documentation]
- [Testing Library query guidance]
- [Testing Library user-event guidance]
- [Testing Library user-event convenience APIs]

[Browser Mode Admission]: #browser-mode-admission
[Dify UI testing contract]: ../../packages/dify-ui/docs/testing.md
[React Testing Library documentation]: https://testing-library.com/docs/react-testing-library/intro
[Storybook Vitest addon]: https://storybook.js.org/docs/writing-tests/integrations/vitest-addon
[Testing Library guiding principles]: https://testing-library.com/docs/guiding-principles
[Testing Library query guidance]: https://testing-library.com/docs/queries/about
[Testing Library user-event convenience APIs]: https://testing-library.com/docs/user-event/convenience
[Testing Library user-event guidance]: https://testing-library.com/docs/user-event/intro
[Vite+ testing configuration]: https://viteplus.dev/guide/test
[Vitest Browser Mode documentation]: https://v4.vitest.dev/guide/browser
[Vitest Browser Mode locators]: https://v4.vitest.dev/api/browser/locators
[Vitest Browser Mode traces]: https://v4.vitest.dev/guide/browser/trace-view
[Vitest Interactivity API]: https://v4.vitest.dev/api/browser/interactivity
[Vitest component testing]: https://v4.vitest.dev/guide/browser/component-testing
[Vitest documentation]: https://v4.vitest.dev/guide
[Vitest test projects]: https://v4.vitest.dev/guide/projects
[Vitest visual regression testing]: https://v4.vitest.dev/guide/browser/visual-regression-testing
[Why Browser Mode]: https://v4.vitest.dev/guide/browser/why
[static checks]: lint.md
