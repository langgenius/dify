# Frontend Testing Guide

This document is the single source of truth for automated frontend tests under `web/`. Tests should protect product behavior and make refactoring safer. They are not a file-by-file completion exercise.

## Testing Mindset

Write or update a test when a change affects a stable, observable contract:

- User interactions and resulting UI state.
- Navigation, URL state, persistence, permissions, or data flow.
- Loading, success, error, and empty states that users can actually reach.
- Accessibility semantics, keyboard behavior, focus management, or disabled state.
- Business logic or a reusable utility with meaningful input/output behavior.
- A bug fix whose regression can be reproduced through a public boundary.

Do not add a test only because:

- A component, hook, prop, branch, or file exists.
- A component can be rendered without crashing.
- An implementation uses `useState`, `useEffect`, `useMemo`, or `useCallback`.
- A coverage report shows an uncovered line.
- TypeScript already makes an input impossible.
- A change only adjusts classes, spacing, colors, or responsive layout without changing behavior.

For visual-only changes, verify the real UI at representative widths and states. Use browser, screenshot, Storybook, or end-to-end coverage when the risk justifies automation.

### Coverage

Coverage is a diagnostic signal, not a quality target. This guide defines no required percentage and reviewers should not request tests solely to increase coverage. Use a report to find suspicious gaps, then decide whether each gap represents a product risk worth protecting.

## Choose the Right Boundary

Use the smallest boundary that proves the product contract without coupling the test to implementation:

- Test pure transformations and business rules as unit tests.
- Test hooks directly only when the hook itself exposes a reusable public contract. Otherwise, exercise the hook through its owning component or feature.
- Use React Testing Library for component and feature behavior visible through the DOM or external side effects.
- Use integration tests for behavior that crosses meaningful module boundaries.
- Use a real browser for layout, responsive behavior, browser-specific APIs, animation, and focus behavior that `happy-dom` cannot represent faithfully.
- Follow `packages/dify-ui/README.md` for the Storybook and Vitest boundary of Dify UI primitives.

Test the behavior owner. Barrel exports, pass-through wrappers, and purely presentational children do not need separate tests when the owning feature already proves their contract.

## Assert Behavior, Not Implementation

- Drive state transitions through props, user interaction, URL changes, or public APIs.
- Assert rendered UI, ARIA state, navigation, persistence, network-boundary calls, or another observable result.
- Do not inspect React state, refs, hook call order, effect dependencies, or private DOM structure.
- Test referential identity only when identity is itself a documented public contract.
- One test should describe one behavior. It may contain multiple assertions when they jointly prove that behavior.
- Test only input states supported by the type and product contract. Do not manufacture `null`, `undefined`, or extreme values without a reachable scenario.
- Avoid snapshots and CSS class assertions unless the serialized output or class contract is intentionally public and stable.

## Queries, Interaction, and Accessibility

Prefer selectors in this order:

1. `getByRole` with an accessible name.
1. `getByLabelText` for labeled form controls.
1. Scoped semantic queries with `within`.
1. `getByText`, `getByPlaceholderText`, or other user-visible queries when appropriate.
1. `getByTestId` only for boundaries with no useful DOM semantics, such as canvas output, editor shims, or mocked non-visual integrations.

If an interactive control cannot be found semantically, first check whether the production markup needs a real button, link, label, landmark, or accessible name.

- Prefer a `userEvent.setup()` instance created inside the test for realistic interaction sequences. Use `fireEvent` for a specific low-level event that `userEvent` does not express.
- Test keyboard and focus behavior when they are part of the interaction contract.
- Assert accessible names and ARIA state when they communicate product state.
- Exact copy assertions are valid when the copy or translation key is the contract; otherwise prefer a semantic query or resilient match.
- Use `queryBy*` for absence and `findBy*` for asynchronously appearing elements.

## Mock at Real Boundaries

Use real components within the owning feature by default, especially when primitive semantics, context wiring, or integration behavior matters. Mock only where isolation improves the signal:

- Service and network boundaries.
- Next.js navigation or browser APIs not provided by the test environment.
- External SDKs and expensive providers.
- Independently tested child boundaries whose setup would otherwise dominate the owner test.

Mocks must preserve the public contract needed by the test. Do not replace Dify UI or legacy base primitives with semantically inaccurate stubs just to make a test easier.

- Never make real network requests.
- Reset shared mock state before each test that mutates it.
- Create a fresh TanStack Query client for tests that exercise query behavior.
- Prefer typed builders with valid defaults for complex data. Add overrides only for fields relevant to the scenario.
- Keep local mocks local. Move a mock helper to `web/__mocks__/` only when multiple suites genuinely share it.

## Async, Time, and Isolation

- Await `userEvent`, promises, `findBy*`, and `waitFor`.
- Use `findBy*` for an element that appears asynchronously and `waitFor` for an eventually true external assertion.
- Use fake timers only when timer behavior is part of the contract. Restore real timers after the test.
- Control time, randomness, network responses, and shared stores so tests are deterministic.
- `web/vitest.setup.ts` already runs Testing Library cleanup and resets Zustand stores after each test.
- Call `vi.clearAllMocks()` in `beforeEach` when a suite relies on mock call history. Do not use `afterEach` to prepare the next test.

## Dify Test Setup

- Vitest runs in `happy-dom` through `web/vite.config.ts` and loads `web/vitest.setup.ts`.
- New component and feature specs should generally use a sibling `__tests__/` directory. Existing colocated utility and hook specs may follow their owning module's convention. Cross-feature integration specs belong in `web/__tests__/`.
- The shared `react-i18next` mock is loaded globally. Use `createReactI18nextMock` from `web/test/i18n-mock` only when a test needs custom translations.
- For `nuqs` behavior, use the helpers in `web/test/nuqs-testing.tsx` and assert URL updates. Mock `nuqs` only when URL synchronization is explicitly outside the test contract.
- Do not add another test runner, DOM environment, or network interception library without a demonstrated project-level need.

## Workflow

1. Read the behavior owner, its public dependencies, and nearby tests.
1. State the contract and regression risk before deciding to add tests.
1. Choose the smallest boundary that proves the contract.
1. For a behavior change or bug fix, establish the failing case first when practical.
1. Implement one coherent scenario, run its focused spec, and fix failures before expanding scope.
1. Run the affected suite and the relevant repository checks.
1. Remove redundant assertions, unnecessary mocks, and tests that only mirror implementation.

When working across several files, order the work by dependency and verify each coherent slice before continuing. Do not create one test file per source file by default.

## Commands

Run from `web/`:

```bash
# Focused spec or directory
vp test run path/to/spec-or-directory

# All web tests
vp test run

# Watch mode
vp test watch path/to/spec

# Diagnostic coverage report; not an acceptance target
vp test run --coverage path/to/spec-or-directory
```

## Review Checklist

- Does each test protect a reachable product contract or meaningful regression?
- Is the behavior exercised through a public boundary?
- Are semantic queries and accessibility contracts used where relevant?
- Are mocks placed at intentional boundaries and faithful to those boundaries?
- Is the suite deterministic, focused, and cheaper to maintain than the regression it prevents?
- Would the test survive a refactor that preserves behavior?

## References

- [Vitest documentation]
- [Testing Library guiding principles]
- [React Testing Library documentation]
- [Testing Library query guidance]
- [Testing Library user-event guidance]

[React Testing Library documentation]: https://testing-library.com/docs/react-testing-library/intro
[Testing Library guiding principles]: https://testing-library.com/docs/guiding-principles
[Testing Library query guidance]: https://testing-library.com/docs/queries/about
[Testing Library user-event guidance]: https://testing-library.com/docs/user-event/intro
[Vitest documentation]: https://vitest.dev/guide
