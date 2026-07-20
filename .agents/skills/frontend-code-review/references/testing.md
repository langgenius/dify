# Testing Review Rules

`web/docs/test.md` is the canonical frontend testing policy. Use this file only to translate that policy into review findings.

## Request Missing Tests When Risk Justifies Them

Flag missing coverage when a change alters a reachable contract such as:

- User interaction, navigation, form submission, validation, or permissions.
- Query or mutation behavior, URL state, persistence, or one-shot signals.
- Loading, error, empty, and recovery states that users can encounter.
- Accessibility-critical labels, keyboard flow, focus, disabled state, or overlay behavior.
- A regression-prone business rule or bug fix that can be reproduced through a public boundary.

Do not request tests for mechanical changes, pass-through wrappers, implementation details, or visual-only styling unless they affect behavior. Low coverage alone is not a finding.

## Flag Low-Value or Fragile Tests

Flag tests that:

- Assert internal state, refs, hook usage, effect dependencies, private DOM structure, or cosmetic classes.
- Exist only to render a component, exercise a prop, or cover generic invalid inputs without a product scenario.
- Mock away the behavior under review or use mocks that do not match the public contract.
- Add production `data-testid` attributes where semantic markup would work.
- Use fake timers without timer behavior, leave async work unawaited, or leak shared state.
- Duplicate a contract already protected at a more useful owner boundary.

## Review the Test Boundary

- Prefer semantic queries and accessible names.
- Prefer real feature components when integration semantics matter.
- Allow intentional child or provider mocks when setup would dominate the test and that boundary is covered independently.
- Do not accept semantically inaccurate mocks of Dify UI or legacy base primitives.
- Require a real-browser or visual verification plan when `happy-dom` cannot represent the risk.

Treat test quality, determinism, and regression value as the review criteria. Do not use test count or coverage percentage as a proxy for quality.
