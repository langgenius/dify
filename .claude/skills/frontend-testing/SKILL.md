---
name: Dify Frontend Testing
description: Generate Jest + RTL tests for Dify frontend. Triggers on testing, spec files, coverage, Jest, RTL keywords, or write/review test requests.
---

# Dify Frontend Testing Skill

This skill enables Claude to generate high-quality, comprehensive frontend tests for the Dify project following established conventions and best practices.

> **⚠️ Authoritative Source**: This skill is derived from `web/testing/testing.md`. When in doubt, always refer to that document as the canonical specification.

## When to Apply This Skill

Apply this skill when the user:
- Asks to **write tests** for a component, hook, or utility
- Asks to **review existing tests** for completeness
- Mentions **Jest**, **React Testing Library**, **RTL**, or **spec files**
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
| Jest | 29.7 | Test runner |
| React Testing Library | 16.0 | Component testing |
| happy-dom | - | Test environment |
| nock | 14.0 | HTTP mocking |
| TypeScript | 5.x | Type safety |

### Key Commands

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test -- --watch

# Run specific file
pnpm test -- path/to/file.spec.tsx

# Generate coverage report
pnpm test -- --coverage

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

// Mock dependencies
jest.mock('@/service/api')

// Shared state for mocks (if needed)
let mockSharedState = false

describe('ComponentName', () => {
  beforeEach(() => {
    jest.clearAllMocks()  // ✅ Reset mocks BEFORE each test
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
      const handleClick = jest.fn()
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

## Testing Strategy

### Path-Level Testing (Directory Testing)

When assigned to test a directory/path, test **ALL content** within that path:

- Test all components, hooks, utilities in the directory (not just `index` file)
- Can use a single `.spec.tsx` file or split into multiple files
- Goal: 100% coverage of ALL files in the directory

### Integration Testing First

**Prefer integration testing** when writing tests for a directory:

1. **DO NOT mock base components** (`Loading`, `Button`, `Tooltip`, etc. from `@/app/components/base/`)
   - Base components will have their own dedicated tests
   - Use real components to test actual integration behavior

2. **Minimize mocking** - Only mock:
   - External API calls (`@/service/*`)
   - Complex context providers that are difficult to set up
   - Third-party libraries with side effects (e.g., `next/navigation`)

3. **Import real project components** instead of mocking them

```typescript
// ❌ Don't mock base components
jest.mock('@/app/components/base/loading', () => () => <div>Loading</div>)

// ✅ Import and use real base components
import Loading from '@/app/components/base/loading'
// The real Loading component will render in tests
```

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
2. **Props**: Required props, optional props, default values
3. **Edge Cases**: null, undefined, empty values, boundary conditions

### Conditional (When Present)

| Feature | Test Focus |
|---------|-----------|
| `useState` | Initial state, transitions, cleanup |
| `useEffect` | Execution, dependencies, cleanup |
| Event handlers | All onClick, onChange, onSubmit |
| API calls | Loading, success, error states |
| Routing | Navigation, params, query strings |
| `useCallback`/`useMemo` | Referential equality |

## Coverage Goals

- ✅ **100%** function coverage
- ✅ **100%** statement coverage
- ✅ **>95%** branch coverage
- ✅ **>95%** line coverage

## Detailed Guides

For more detailed information, refer to:
- `guides/mocking.md` - Mock patterns and best practices
- `guides/async-testing.md` - Async operations and API calls
- `guides/domain-components.md` - Workflow, Dataset, Configuration testing
- `guides/common-patterns.md` - Frequently used testing patterns

## Authoritative References

### Primary Specification (MUST follow)

- **`web/testing/testing.md`** - The canonical testing specification. This skill is derived from this document.

### Reference Examples in Codebase

- `web/utils/classnames.spec.ts` - Utility function tests
- `web/app/components/base/button/index.spec.tsx` - Component tests
- `web/__mocks__/provider-context.ts` - Mock factory example

### Project Configuration

- `web/jest.config.ts` - Jest configuration
- `web/jest.setup.ts` - Test environment setup
- `web/testing/analyze-component.js` - Component analysis tool
