# Testing Review Rules

Use these rules when reviewing test files, testability of changed code, or risky frontend changes that should have tests.

## Missing Coverage

Flag missing tests when the change affects:

- User-visible behavior, navigation, form submission, validation, permissions, or loading/error/empty states.
- Query/mutation cache behavior.
- Accessibility-critical behavior such as labels, keyboard flow, focus, disabled state, or popup reachability.
- URL state parsing/serialization.
- Storage persistence or one-shot signals.
- Regression-prone workflow or generated contract migration paths.

Do not request tests for purely mechanical renames or styling-only changes unless the styling affects layout, focus, or interaction.

## Selectors

Flag:

- `getByTestId` used where role, label, text, placeholder, landmark, or scoped dialog/menu queries are available.
- Production `data-testid` added only to satisfy tests.
- Assertions against decorative icons rather than the named control.
- Tests that cannot find controls semantically but leave broken markup unchanged.

Prefer `getByRole` with accessible name, then `getByLabelText`, `getByPlaceholderText`, `getByText`, and `within(...)`.

## Mocking

Flag:

- Mocking `@langgenius/dify-ui/*` primitives.
- Mocking `@/app/components/base/*` components when the real component is practical.
- Mocking sibling or child components in the same directory for integration behavior.
- Mocks that do not match the real component's conditional rendering.
- Module-level mock state not reset in `beforeEach`.
- `vi.clearAllMocks()` in `afterEach` instead of `beforeEach`.

Use real project components for integration behavior. Mock APIs, `next/navigation`, browser shims, or complex providers only when setup would dominate the test.

## Behavior

Flag:

- Tests inspecting implementation details instead of user-observable behavior.
- Assertions that hardcode brittle copy when pattern matching or semantic roles would express behavior better.
- Fake timers used without real timing behavior.
- Async assertions missing `await`, `findBy*`, or `waitFor`.
- Test data missing required fields because inline partial objects bypass real types.

Use typed factory functions with complete defaults and partial overrides.

## URL State

For `nuqs` or query-state hooks, flag tests that:

- Mock URL state when URL synchronization is the behavior under review.
- Do not test parser serialize/parse round trips for custom parsers.
- Do not assert default-clearing behavior when defaults should be removed from the URL.

Prefer shared `NuqsTestingAdapter` helpers when available.

## Organization

Flag:

- Component/hook/util tests outside sibling `__tests__/` directories.
- Directory-level reviews that test only `index.tsx` while other files in scope contain behavior.
- Large test files with repeated setup that should use local builders.

When a component is very complex, prefer a refactor finding before asking for exhaustive tests.
