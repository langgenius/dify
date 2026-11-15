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

The unit coverage report includes authored JavaScript and TypeScript throughout `web/`, including runtime entry points, scripts, plugins, and files that no test imports. It excludes test infrastructure, stories, declarations, generated sources, tool configuration, build output, and vendored static code. TypeScript modules containing only erased types have no executable statements and are not meaningful zero-coverage findings. Local coverage runs also produce an HTML report at `coverage/index.html`.

Run the full `unit` project before using coverage to identify untested modules. A focused run measures only the selected tests. CI collects Browser Mode coverage separately and combines it with unit coverage under the same Codecov `web` flag. Zero unit coverage does not imply that Browser Mode or E2E never exercises the file; E2E does not contribute to the coverage report. Anonymous VM scripts and subprocesses can also execute code without attributing coverage to its source file. Check existing tests and separate product modules from development tooling when prioritizing the findings.

Browser CI sets `DIFY_TEST_COVERAGE_ONLY_EXECUTED=true` so its report includes loaded source files without generating zero-coverage entries for every other Web module. The unit uploads retain the complete authored-source denominator, and Codecov combines both reports. Leave this variable unset when collecting the full unit diagnostic report.

## Choose the Right Boundary

Use the smallest boundary that includes the behavior owner and proves the product contract without coupling the test to implementation:

- Test pure transformations and business rules as unit tests.
- Test hooks directly only when the hook itself exposes a reusable public contract. Otherwise, exercise the hook through its owning component or feature.
- Exercise component and feature behavior through rendered DOM or external side effects.
- Use integration tests for behavior that crosses meaningful module boundaries.
- Default rendered component and feature tests to the `browser` project under [Browser Mode Admission]. Keep non-DOM logic in `unit`.
- Follow the [Dify UI testing contract] for the Storybook and Vitest boundary of Dify UI primitives.

Test the behavior owner. Barrel exports, pass-through wrappers, and purely presentational children do not need separate tests when the owning feature already proves their contract. Do not repeat generic behavior already owned by Base UI, React Aria, or the browser; test Dify's integration, overrides, and known regressions.

### Browser Mode Admission

Rendered React component and feature tests default to the `browser` project in Playwright Chromium. This includes dialogs, forms, pages, editors, canvas, and hooks exercised through a rendered owner. Use `*.browser.spec.{ts,tsx}` under `{app,features}/**`; one scenario belongs to one project. Do not duplicate unit cases in Browser Mode.

Keep `unit` in `happy-dom` when a browser adds no useful evidence: pure functions, types and schemas, request builders, stores or hooks without DOM, and Node or build tooling. Files outside the browser project's include paths also remain in `unit`. If a required capability is unavailable in Browser Mode, explain the concrete blocker in the PR and propose the missing infrastructure instead of emulating browser behavior or weakening the test.

The runtime does not make a weak test valuable. Every retained scenario must still protect a user-visible contract at its faithful production owner. Use the smallest journey that proves that contract with real rendering and interaction. Do not repeat a state matrix merely because a browser fixture exists; each viewport, theme, key, or variant row needs a distinct failure mode. Primitive and native defaults need no separate Dify tests unless Dify's integration or overrides are the contract.

When migrating an existing spec, rewrite happy-dom workarounds into browser behavior: use public close/reopen or prop-change journeys, real layout, native input and semantic locators. Drop zero-size canvas expectations, fake geometry, CSS-class visibility proofs and aria-hiding assertions that stand in for actual removal. Do not merely rename a file or move low-value cases to another runner to preserve coverage. Use the [Vitest Interactivity API] when native gestures, capture or event ordering are the contract.

Do not add permanent tests solely to freeze decorative spacing, radii, or artwork dimensions from a one-off visual adjustment. Geometry and computed styles are appropriate when they prove the chosen contract, such as readable content, unobstructed controls, or visible keyboard focus. Visual baselines need an explicit stable requirement and controlled rendering environment.

Each `*.browser.spec.{ts,tsx}` must make its behavioral contract and browser evidence clear from its scenario and assertions; add a short explanation only when needed. Do not use forced interaction, fixed sleeps, private DOM assertions, or real network requests. When native browser behavior is the contract—including drag data, hit testing, focus and visibility, media sources, fullscreen, or file input—assert that outcome directly; markup state, matcher or helper shortcuts, and mocked browser API calls do not prove it.

Browser input is real and nothing waits between keys. Split a `userEvent.keyboard` sequence wherever a later key depends on state an earlier key produces, such as an opened menu or moved focus, and await that state with `expect.element` before continuing.

Browser Mode remains a focused component or feature test and currently proves Chromium only. Use the end-to-end suite for a running application, authentication, real routing, backend APIs, persistence, or complete journeys.

## Assert Behavior, Not Implementation

- Set initial state through render-time inputs (props, `initialStoreState`, seeded query data), not `store.setState` or internal setters after render. Drive mid-test transitions through user actions or public APIs, including prop and URL updates. Seed a reachable non-empty state before testing reset or clear.
- Assert rendered UI, ARIA state, navigation, persistence, network-boundary calls, or another observable result.
- For a reset-or-persistence regression in a hidden surface, exercise the public transition: open, modify, close and wait for the surface to disappear, then reopen. Assert the intended behavior without coupling the test to hook placement, component names, keys, or private mount structure.
- Do not inspect React state, refs, hook call order, effect dependencies, or private DOM structure.
- Test referential identity only when identity is itself a documented public contract.
- One test should describe one behavior. It may contain multiple assertions when they jointly prove that behavior.
- Test only input states supported by the type and product contract. Do not manufacture `null`, `undefined`, or extreme values without a reachable scenario.
- Do not assert CSS class names or mechanically translate them into computed-style assertions. Assert the required outcome; use visual review for incidental styling.
- Use DOM or data snapshots only when serialized output is itself an intentionally public, stable contract. Visual baselines follow Browser Mode Admission.
- Never accept both correct and suspicious results, such as parsing again when a value is still a string. Assert the correct contract; if production violates it, mark the case `it.fails` with a tracking issue link and fix production separately.

## Queries, Interaction, and Accessibility

Prefer selectors in this order:

1. `getByRole` with an accessible name.
1. `getByLabelText` for labeled form controls.
1. `getByText`, `getByPlaceholderText`, or other user-visible queries when appropriate.
1. `getByTestId` only for boundaries with no useful DOM semantics, such as canvas output, editor shims, or mocked non-visual integrations.

When repeated content creates ambiguity, narrow to a semantic container, then query within it with `within` in React Testing Library or locator chaining in Browser Mode.

If an interactive control cannot be found semantically, first check whether the production markup needs a real button, link, label, landmark, or accessible name.

- In React Testing Library tests, use a `userEvent.setup()` instance inside the test. Use `fireEvent` only when the low-level event itself is the contract.
- In Browser Mode, interact through awaited locators. Use `.element()` only for DOM APIs that locators do not expose; it does not wait, so await the element with `expect.element` first.
- Semantic queries and automated checks do not constitute complete accessibility conformance.
- Exact copy assertions are valid when the copy or translation key is the contract; otherwise prefer a semantic query or resilient match.
- In React Testing Library, use `queryBy*` for synchronous absence, `findBy*` for asynchronous appearance, and `waitForElementToBeRemoved` or `waitFor` for asynchronous disappearance. In Browser Mode, use `expect.element` for eventual assertions.

## Mock at Real Boundaries

Keep the production code that owns or transforms the asserted behavior real. Mock only dependencies outside the target contract, where isolation improves the signal:

- Service and network boundaries.
- Next.js navigation or browser APIs not provided by the test environment.
- External SDKs and expensive providers.
- Independently tested child boundaries that do not own or transform the asserted behavior and whose setup would otherwise dominate the owner test.

Mocks must preserve the public contract needed by the test. A mock must not reimplement the owner's transformation, state, or subscription. A child double that only records props or manually invokes captured callbacks does not prove the real control exists or submits valid values; render the real child and drive it, or keep the double at an external SDK or service boundary. Do not mock interactive Dify UI primitives or feature-owned wrappers around them. Keep their semantic roles, state attributes, portals, focus behavior, and `render(props, state)` contract real; mock only service or external-data boundaries needed to reach the scenario.

Put `// boundary: <reason>` immediately above each retained owned-path or otherwise non-obvious mock to name the external or unavailable capability it isolates.

- Never make real network requests.
- Reset shared mock state before each test that mutates it.
- Create a fresh TanStack Query client for tests that exercise query behavior.
- Prefer typed builders with valid defaults for complex data. Add overrides only for fields relevant to the scenario.
- Keep local mocks local. Move a mock helper to `web/__mocks__/` only when multiple suites genuinely share it.

## Async, Time, and Isolation

- Await user interactions, promises, `findBy*`, and `waitFor`.
- Wait for observable state changes. Keep side effects outside `waitFor`. For filtering or refresh, await the intended new result before asserting excluded items are absent.
- When a production debounce or delay is the contract, use fake timers and advance the full window, including before asserting something did not happen. Restore real timers after the test. Otherwise, use real timers and await the visible result; do not lengthen timeouts, use fixed sleeps, or add broad retries to hide incorrect timing.
- Control time, randomness, network responses, and shared stores so tests are deterministic.
- `web/vitest.setup.ts` already runs Testing Library cleanup and resets Zustand stores after each test.
- Vitest 5 clears mock call history before each test. This does not reset mock implementations or external state; set those up explicitly for each case. Do not use `afterEach` to prepare the next test.

## Dify Test Setup

- Following [Vite+ testing configuration], tests under `web/` use two explicit projects; rendered component and feature tests default to `browser`, and non-DOM logic stays in `unit`. Both projects are configured in `web/vite.config.ts`. Supported commands and CI select one project explicitly: `unit` runs in `happy-dom` and loads `web/vitest.setup.ts`, while `browser` runs matching `{app,features}/**/*.browser.spec.{ts,tsx}` files in Playwright Chromium and loads `web/vitest.browser.setup.ts`. Bare `vp test` runs both registered projects.
- Browser string locators use Vitest 5's exact, case-sensitive matching; use a regular expression or a per-locator `{ exact: false }` only when partial matching protects the intended behavior. Node tests use `@testing-library/jest-dom/vitest`; in Browser Mode, `toHaveTextContent` checks the entire normalized text, while `toMatchTextContent` handles substring or regular-expression checks, including negated partial checks.
- Browser Mode omits dependency sourcemaps and the Playwright trace screenshot filmstrip. Application sourcemaps, mapped error stacks, failure screenshots, and DOM snapshots in retained traces remain available. Pass `--browser.dependencySourcemaps` when debugging into third-party dependencies.
- Tests in one browser file share a page. `web/vitest.browser.setup.ts` resets the viewport and pointer before each test; set the viewport a test depends on inside that test.
- Keep one behavior domain per Browser spec and split suites near 500 lines. Scope fixtures and mocks to the file that uses them; extract only genuinely shared, side-effect-free presets.
- Browser failures keep screenshots under `web/.vitest-browser/`. Playwright traces are disabled locally to avoid large disk usage; CI retains traces on failure and uploads that directory only when failure artifacts exist. Browser Mode does not own coverage or report merging.
- New component and feature specs should generally use a sibling `__tests__/` directory. Existing colocated utility and hook specs may follow their owning module's convention. Cross-feature integration specs belong in `web/__tests__/`.
- Shared test helpers must have no import-time side effects: no `beforeEach`/`afterEach` registration, global or fetch stubbing, or assertions. Render helpers accept initial store state and injected props and return the real stores and query client. When two or more specs need the same query-cache seed, extract a side-effect-free preset under `web/test/`, distinct from `__mocks__`, that seeds only the client passed in.
- The shared `react-i18next` mock is loaded globally. Use `createReactI18nextMock` from `web/test/i18n-mock` only when a test needs custom translations.
- For `nuqs` behavior, use the helpers in `web/test/nuqs-testing.tsx` and assert URL updates. Mock `nuqs` only when URL synchronization is explicitly outside the test contract.
- Do not add another test runner, DOM environment, or network interception library without a demonstrated project-level need.

## Workflow

Use the behavior owner and nearby tests to identify a realistic regression and the assertion that would catch it. For a behavior change or bug fix, establish the failing case first when practical. Remove redundant tests and assertions as readily as adding missing coverage. When an old test reached a race, rollback, or sync scenario by mutating internals, rewrite it through a real entry point (socket event, refetch, user action) before deleting it. Internal mutation alone does not prove the scenario is unreachable.

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
[Vitest Browser Mode documentation]: https://vitest.dev/guide/browser
[Vitest Browser Mode locators]: https://vitest.dev/api/browser/locators
[Vitest Browser Mode traces]: https://vitest.dev/guide/browser/trace-view
[Vitest Interactivity API]: https://vitest.dev/api/browser/interactivity
[Vitest documentation]: https://vitest.dev/guide
[Vitest test projects]: https://vitest.dev/guide/projects
[Why Browser Mode]: https://vitest.dev/guide/browser/why
[static checks]: lint.md
