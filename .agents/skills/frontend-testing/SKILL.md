---
name: frontend-testing
description: Generate Vitest + React Testing Library tests for Dify frontend components, hooks, and utilities. Triggers on testing, spec files, coverage, Vitest, RTL, unit tests, integration tests, or write/review test requests.
---

# Dify Frontend Testing Skill

This skill enables Claude to generate high-quality, comprehensive frontend tests for the Dify project following established conventions and best practices.

> **⚠️ Authoritative Source**: This skill is derived from `web/testing/testing.md`. Use Vitest mock/timer APIs (`vi.*`).

## When to Apply This Skill

Apply this skill when the user:

- Asks to **write tests** for a component, hook, or utility
- Asks to **review existing tests** for completeness
- Mentions **Vitest**, **React Testing Library**, **RTL**, or **spec files**
- Requests **test coverage** improvement
- Uses `pnpm analyze-component` output as context
- Mentions **testing**, **unit tests**, or **integration tests** for frontend code
- Wants to understand **testing patterns** in the Dify codebase

**Do NOT apply** when:

- User is asking about backend/API tests (Python/pytest)
- User is asking about E2E tests (Playwright/Cypress)
- User is only asking conceptual questions without code context

## Quick Reference

### Tech Stack

| Tool | Version | Purpose |
|------|---------|---------|
| Vitest | 4.0.16 | Test runner |
| React Testing Library | 16.0 | Component testing |
| jsdom | - | Test environment |
| nock | 14.0 | HTTP mocking |
| TypeScript | 5.x | Type safety |

### Key Commands

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Run specific file
pnpm test path/to/file.spec.tsx

# Generate coverage report
pnpm test:coverage

# Analyze component complexity
pnpm analyze-component <path>

# Review existing test
pnpm analyze-component <path> --review
```

### File Naming

- Test files: `ComponentName.spec.tsx` (same directory as component)
- Integration tests: `web/__tests__/` directory

## Test Structure Template

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Component from './index'

// ✅ Import real project components (DO NOT mock these)
// import Loading from '@/app/components/base/loading'
// import { ChildComponent } from './child-component'

// ✅ Mock external dependencies only
vi.mock('@/service/api')
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
}))

// ✅ Zustand stores: Use real stores (auto-mocked globally)
// Set test state with: useAppStore.setState({ ... })

// Shared state for mocks (if needed)
let mockSharedState = false

describe('ComponentName', () => {
  beforeEach(() => {
    vi.clearAllMocks()  // ✅ Reset mocks BEFORE each test
    mockSharedState = false  // ✅ Reset shared state
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = { title: 'Test' }
      
      // Act
      render(<Component {...props} />)
      
      // Assert
      expect(screen.getByText('Test')).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should apply custom className', () => {
      render(<Component className="custom" />)
      expect(screen.getByRole('button')).toHaveClass('custom')
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should handle click events', () => {
      const handleClick = vi.fn()
      render(<Component onClick={handleClick} />)
      
      fireEvent.click(screen.getByRole('button'))
      
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle null data', () => {
      render(<Component data={null} />)
      expect(screen.getByText(/no data/i)).toBeInTheDocument()
    })

    it('should handle empty array', () => {
      render(<Component items={[]} />)
      expect(screen.getByText(/empty/i)).toBeInTheDocument()
    })
  })
})
```

## Testing Workflow (CRITICAL)

### ⚠️ Incremental Approach Required

**NEVER generate all test files at once.** For complex components or multi-file directories:

1. **Analyze & Plan**: List all files, order by complexity (simple → complex)
1. **Process ONE at a time**: Write test → Run test → Fix if needed → Next
1. **Verify before proceeding**: Do NOT continue to next file until current passes

```
For each file:
  ┌────────────────────────────────────────┐
  │ 1. Write test                          │
  │ 2. Run: pnpm test <file>.spec.tsx      │
  │ 3. PASS? → Mark complete, next file    │
  │    FAIL? → Fix first, then continue    │
  └────────────────────────────────────────┘
```

### Complexity-Based Order

Process in this order for multi-file testing:

1. 🟢 Utility functions (simplest)
1. 🟢 Custom hooks
1. 🟡 Simple components (presentational)
1. 🟡 Medium components (state, effects)
1. 🔴 Complex components (API, routing)
1. 🔴 Integration tests (index files - last)

### When to Refactor First

- **Complexity > 50**: Break into smaller pieces before testing
- **500+ lines**: Consider splitting before testing
- **Many dependencies**: Extract logic into hooks first

> 📖 See `references/workflow.md` for complete workflow details and todo list format.

## Testing Strategy

### Path-Level Testing (Directory Testing)

When assigned to test a directory/path, test **ALL content** within that path:

- Test all components, hooks, utilities in the directory (not just `index` file)
- Use incremental approach: one file at a time, verify each before proceeding
- Goal: 100% coverage of ALL files in the directory

### Integration Testing First

**Prefer integration testing** when writing tests for a directory:

- ✅ **Import real project components** directly (including base components and siblings)
- ✅ **Only mock**: API services (`@/service/*`), `next/navigation`, complex context providers
- ❌ **DO NOT mock** base components (`@/app/components/base/*`)
- ❌ **DO NOT mock** sibling/child components in the same directory

> See [Test Structure Template](#test-structure-template) for correct import/mock patterns.

## Core Principles

### 1. AAA Pattern (Arrange-Act-Assert)

Every test should clearly separate:

- **Arrange**: Setup test data and render component
- **Act**: Perform user actions
- **Assert**: Verify expected outcomes

### 2. Black-Box Testing

- Test observable behavior, not implementation details
- Use semantic queries (getByRole, getByLabelText)
- Avoid testing internal state directly
- **Prefer pattern matching over hardcoded strings** in assertions:

```typescript
// ❌ Avoid: hardcoded text assertions
expect(screen.getByText('Loading...')).toBeInTheDocument()

// ✅ Better: role-based queries
expect(screen.getByRole('status')).toBeInTheDocument()

// ✅ Better: pattern matching
expect(screen.getByText(/loading/i)).toBeInTheDocument()
```

### 3. Single Behavior Per Test

Each test verifies ONE user-observable behavior:

```typescript
// ✅ Good: One behavior
it('should disable button when loading', () => {
  render(<Button loading />)
  expect(screen.getByRole('button')).toBeDisabled()
})

// ❌ Bad: Multiple behaviors
it('should handle loading state', () => {
  render(<Button loading />)
  expect(screen.getByRole('button')).toBeDisabled()
  expect(screen.getByText('Loading...')).toBeInTheDocument()
  expect(screen.getByRole('button')).toHaveClass('loading')
})
```

### 4. Semantic Naming

Use `should <behavior> when <condition>`:

```typescript
it('should show error message when validation fails')
it('should call onSubmit when form is valid')
it('should disable input when isReadOnly is true')
```

## Required Test Scenarios

### Always Required (All Components)

1. **Rendering**: Component renders without crashing
1. **Props**: Required props, optional props, default values
1. **Edge Cases**: null, undefined, empty values, boundary conditions

### Conditional (When Present)

| Feature | Test Focus |
|---------|-----------|
| `useState` | Initial state, transitions, cleanup |
| `useEffect` | Execution, dependencies, cleanup |
| Event handlers | All onClick, onChange, onSubmit, keyboard |
| API calls | Loading, success, error states |
| Routing | Navigation, params, query strings |
| `useCallback`/`useMemo` | Referential equality |
| Context | Provider values, consumer behavior |
| Forms | Validation, submission, error display |

## Coverage Goals (Per File)

For each test file generated, aim for:

- ✅ **100%** function coverage
- ✅ **100%** statement coverage
- ✅ **>95%** branch coverage
- ✅ **>95%** line coverage

> **Note**: For multi-file directories, process one file at a time with full coverage each. See `references/workflow.md`.

## Detailed Guides

For more detailed information, refer to:

- `references/workflow.md` - **Incremental testing workflow** (MUST READ for multi-file testing)
- `references/mocking.md` - Mock patterns, Zustand store testing, and best practices
- `references/async-testing.md` - Async operations and API calls
- `references/domain-components.md` - Workflow, Dataset, Configuration testing
- `references/common-patterns.md` - Frequently used testing patterns
- `references/checklist.md` - Test generation checklist and validation steps

## Authoritative References

### Primary Specification (MUST follow)

- **`web/testing/testing.md`** - The canonical testing specification. This skill is derived from this document.

### Reference Examples in Codebase

- `web/utils/classnames.spec.ts` - Utility function tests
- `web/app/components/base/button/index.spec.tsx` - Component tests
- `web/__mocks__/provider-context.ts` - Mock factory example

### Project Configuration

- `web/vitest.config.ts` - Vitest configuration
- `web/vitest.setup.ts` - Test environment setup
- `web/scripts/analyze-component.js` - Component analysis tool
- Modules are not mocked automatically. Global mocks live in `web/vitest.setup.ts` (for example `react-i18next`, `next/image`); mock other modules like `ky` or `mime` locally in test files.
