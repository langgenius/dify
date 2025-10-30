# Windsurf Testing Rules

- Use `web/testing/TESTING.md` as the single source of truth for frontend automated testing.
- Honor every requirement in that document when generating or accepting tests.
- Key reminders:
  - Tech stack: Next.js 15, React 19, TypeScript, Jest 29.7, React Testing Library 16.0, `@happy-dom/jest-environment`
  - File naming: `ComponentName.spec.tsx` next to the component
  - Structure: Arrange → Act → Assert, descriptive test names, `fireEvent`, `afterEach(() => jest.clearAllMocks())`
  - Mandatory coverage: rendering, prop variants, `null`/`undefined`/empty edge cases
  - Conditional coverage: hooks, handlers, async/API flows, routing, performance hooks, workflow/dataset/config components
  - Coverage goals: line & branch >95%, function & statement 100%
