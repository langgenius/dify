# Copilot Instructions

GitHub Copilot must follow the unified frontend testing requirements documented in `web/testing/testing.md`.

Key reminders:

- Generate tests using the mandated tech stack, naming, and code style (AAA pattern, `fireEvent`, descriptive test names, cleans up mocks).
- Cover rendering, prop combinations, and edge cases by default; extend coverage for hooks, routing, async flows, and domain-specific components when applicable.
- Target >95% line and branch coverage and 100% function/statement coverage.
- Apply the project's mocking conventions for i18n, toast notifications, and Next.js utilities.

Any suggestions from Copilot that conflict with `web/testing/testing.md` should be revised before acceptance.
