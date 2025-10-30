# Frontend Testing Guide

This document is the complete testing specification for the Dify frontend project.

## Tech Stack

- **Framework**: Next.js 15 + React 19 + TypeScript
- **Testing Tools**: Jest 29.7 + React Testing Library 16.0
- **Test Environment**: @happy-dom/jest-environment
- **File Naming**: `ComponentName.spec.tsx` (same directory as component)

## Running Tests

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test -- --watch

# Generate coverage report
pnpm test -- --coverage

# Run specific file
pnpm test -- path/to/file.spec.tsx
```

## Project Test Setup

- **Configuration**: `jest.config.ts` loads the Testing Library presets, sets the `@happy-dom/jest-environment`, and respects our path aliases (`@/...`). Check this file before adding new transformers or module name mappers.
- **Global setup**: `jest.setup.ts` already imports `@testing-library/jest-dom` and runs `cleanup()` after every test. Add any environment-level mocks (for example `ResizeObserver`, `matchMedia`, `IntersectionObserver`, `TextEncoder`, `crypto`) here so they are shared consistently.
- **Manual mocks**: Place reusable mocks inside `web/__mocks__/`. Use `jest.mock('module-name')` to point to these helpers rather than redefining mocks in every spec.
- **Script utilities**: `web/testing/analyze-component.js` reports component complexity; `pnpm analyze-component <path>` should be part of the planning step for non-trivial components.
- **Integration suites**: Files in `web/__tests__/` exercise cross-component flows. Prefer adding new end-to-end style specs there rather than mixing them into component directories.

## Component Complexity Guidelines

Use `pnpm analyze-component <path>` to analyze component complexity and adopt different testing strategies based on the results.

### 🔴 Very Complex Components (Complexity > 50)

- **Refactor first**: Break component into smaller pieces
- **Integration tests**: Test complex workflows end-to-end
- **Data-driven tests**: Use `test.each()` for multiple scenarios
- **Performance benchmarks**: Add performance tests for critical paths

### ⚠️ Complex Components (Complexity 30-50)

- **Multiple describe blocks**: Group related test cases
- **Integration scenarios**: Test feature combinations
- **Organized structure**: Keep tests maintainable

### 📏 Large Components (500+ lines)

- **Consider refactoring**: Split into smaller components if possible
- **Section testing**: Test major sections separately
- **Helper functions**: Reduce test complexity with utilities

## Test Scenarios

Apply the following test scenarios based on component features:

### 1. Rendering Tests (REQUIRED - All Components)

**Key Points**:
- Verify component renders properly
- Check key elements exist
- Use semantic queries (getByRole, getByLabelText)

### 2. Props Testing (REQUIRED - All Components)

**Must Test**:
- ✅ Different values for each prop
- ✅ Required vs optional props
- ✅ Default values
- ✅ Props type validation

### 3. State Management

#### useState

When testing state-related components:
- ✅ Test initial state values
- ✅ Test all state transitions
- ✅ Test state reset/cleanup scenarios

#### useEffect

When testing side effects:
- ✅ Test effect execution conditions
- ✅ Verify dependencies array correctness
- ✅ Test cleanup function on unmount

#### useState + useEffect Combined

- ✅ Test state initialization and updates
- ✅ Test useEffect dependencies array
- ✅ Test cleanup functions (useEffect return value)
- ✅ Use `waitFor()` for async state changes

#### Context, Providers, and Stores

- ✅ Wrap components with the actual provider from `web/context` or `app/components/.../context` whenever practical.
- ✅ When creating lightweight provider stubs, mirror the real default values and surface helper builders (for example `createMockWorkflowContext`).
- ✅ Reset shared stores (React context, Zustand, TanStack Query cache) between tests to avoid leaking state. Prefer helper factory functions over module-level singletons in specs.
- ✅ For hooks that read from context, use `renderHook` with a custom wrapper that supplies required providers.

### 4. Performance Optimization

#### useCallback

- ✅ Verify callbacks maintain referential equality
- ✅ Test callback dependencies
- ✅ Ensure re-renders don't recreate functions unnecessarily

#### useMemo

- ✅ Test memoization dependencies
- ✅ Ensure expensive computations are cached
- ✅ Verify memo recomputation conditions

### 5. Event Handlers

**Must Test**:
- ✅ All onClick, onChange, onSubmit handlers
- ✅ Keyboard events (Enter, Escape, Tab, etc.)
- ✅ Verify event.preventDefault() calls (if needed)
- ✅ Test event bubbling/propagation

**Note**: Use `fireEvent` (not `userEvent`)

### 6. API Calls and Async Operations

**Must Test**:
- ✅ Mock all API calls using `jest.mock`
- ✅ Test retry logic (if applicable)
- ✅ Verify error handling and user feedback
- ✅ Use `waitFor()` for async operations
- ✅ For `@tanstack/react-query`, instantiate a fresh `QueryClient` per spec and wrap with `QueryClientProvider`
- ✅ Clear timers, intervals, and pending promises between tests when using fake timers

**Guidelines**:

- Prefer spying on `global.fetch`/`axios`/`ky` and returning deterministic responses over reaching out to the network.
- Use MSW (`msw` is already installed) when you need declarative request handlers across multiple specs.
- Keep async assertions inside `await waitFor(...)` blocks or the async `findBy*` queries to avoid race conditions.

### 7. Next.js Routing

**Must Test**:
- ✅ Mock useRouter, usePathname, useSearchParams
- ✅ Test navigation behavior and parameters
- ✅ Test query string handling
- ✅ Verify route guards/redirects (if any)
- ✅ Test URL parameter updates

### 8. Edge Cases (REQUIRED - All Components)

**Must Test**:
- ✅ null/undefined/empty values
- ✅ Boundary conditions
- ✅ Error states
- ✅ Loading states
- ✅ Unexpected inputs

### 9. Accessibility Testing (Optional)

- Test keyboard navigation
- Verify ARIA attributes
- Test focus management
- Ensure screen reader compatibility

### 10. Snapshot Testing (Use Sparingly)

**Only Use For**:
- ✅ Stable UI (icons, badges, static layouts)
- ✅ Snapshot small sections only
- ✅ Prefer explicit assertions over snapshots
- ✅ Update snapshots intentionally, not automatically

**Note**: Dify is a desktop application. **No need for** responsive/mobile testing.

## Code Style

### Basic Guidelines

- ✅ Use `fireEvent` instead of `userEvent`
- ✅ AAA pattern: Arrange (setup) → Act (execute) → Assert (verify)
- ✅ Descriptive test names: `"should [behavior] when [condition]"`
- ✅ TypeScript: No `any` types
- ✅ Cleanup: `afterEach(() => jest.clearAllMocks())`

### Example Structure

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Component from './index'

// Mock dependencies
jest.mock('@/service/api')

describe('ComponentName', () => {
  // Cleanup after each test
  afterEach(() => {
    jest.clearAllMocks()
  })

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

  describe('User Interactions', () => {
    it('should handle click events', () => {
      const handleClick = jest.fn()
      render(<Component onClick={handleClick} />)
      
      fireEvent.click(screen.getByRole('button'))
      
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle null data', () => {
      render(<Component data={null} />)
      expect(screen.getByText(/no data/i)).toBeInTheDocument()
    })
  })
})
```

## Dify-Specific Components

### General

1. **i18n**: Always return key
   ```typescript
   jest.mock('react-i18next', () => ({
     useTranslation: () => ({
       t: (key: string) => key,
     }),
   }))
   ```

2. **Toast**: Mock toast component
   ```typescript
   jest.mock('@/app/components/base/toast', () => ({
     notify: jest.fn(),
   }))
   ```

3. **Forms**: Test validation logic thoroughly

### Workflow Components (`workflow/`)

**Must Test**:
- ⚙️ **Node configuration**: Test all node configuration options
- ✔️ **Data validation**: Verify input/output validation rules
- 🔄 **Variable passing**: Test data flow between nodes
- 🔗 **Edge connections**: Test graph structure and connections
- ❌ **Error handling**: Verify invalid configuration handling
- 🧪 **Integration**: Test complete workflow execution paths

### Dataset Components (`dataset/`)

**Must Test**:
- 📤 **File upload**: Test file upload and validation
- 📄 **File types**: Verify supported format handling
- 📃 **Pagination**: Test data loading and pagination
- 🔍 **Search & filtering**: Test query functionality
- 📊 **Data format handling**: Test various data formats
- ⚠️ **Error states**: Test upload failures and invalid data

### Configuration Components (`app/configuration`, `config/`)

**Must Test**:
- ✅ **Form validation**: Test all validation rules thoroughly
- 💾 **Save/reset functionality**: Test data persistence
- 🔒 **Required vs optional fields**: Verify field validation
- 📌 **Configuration persistence**: Test state preservation
- 💬 **Error feedback**: Verify user error messages
- 🎯 **Default values**: Test initial configuration state

## Testing Strategy Quick Reference

### Required (All Components)

- ✅ Renders without crashing
- ✅ Props (required, optional, defaults)
- ✅ Edge cases (null, undefined, empty values)

### Conditional (When Present in Component)

- 🔄 **useState** → State initialization, transitions, cleanup
- ⚡ **useEffect** → Execution, dependencies, cleanup
- 🎯 **Event Handlers** → All onClick, onChange, onSubmit, keyboard events
- 🌐 **API Calls** → Loading, success, error states
- 🔀 **Routing** → Navigation, params, query strings
- 🚀 **useCallback/useMemo** → Referential equality, dependencies
- ⚙️ **Workflow** → Node config, data flow, validation
- 📚 **Dataset** → Upload, pagination, search
- 🎛️ **Configuration** → Form validation, persistence

### Complex Components (Complexity 30+)

- Group tests in multiple `describe` blocks
- Test integration scenarios
- Consider splitting component before testing

## Coverage Goals

Aim for 100% coverage:
- **Line coverage**: >95%
- **Branch coverage**: >95%
- **Function coverage**: 100%
- **Statement coverage**: 100%

Generate comprehensive tests covering **all** code paths and scenarios.

## Common Mock Patterns

### Mock Hooks

```typescript
// Mock useState
const mockSetState = jest.fn()
jest.spyOn(React, 'useState').mockImplementation((init) => [init, mockSetState])

// Mock useContext
const mockUser = { name: 'Test User' };
jest.spyOn(React, 'useContext').mockReturnValue({ user: mockUser })
```

### Mock Modules

```typescript
// Mock entire module
jest.mock('@/utils/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
}))

// Mock partial module
jest.mock('@/utils/helpers', () => ({
  ...jest.requireActual('@/utils/helpers'),
  specificFunction: jest.fn(),
}))
```

### Mock Next.js

```typescript
// useRouter
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/current-path',
  useSearchParams: () => new URLSearchParams(),
}))

// next/image
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}))
```

## Debugging Tips

### View Rendered DOM

```typescript
import { screen } from '@testing-library/react'

// Print entire DOM
screen.debug()

// Print specific element
screen.debug(screen.getByRole('button'))
```

### Finding Elements

Priority order (recommended top to bottom):
1. `getByRole` - Most recommended, follows accessibility standards
2. `getByLabelText` - Form fields
3. `getByPlaceholderText` - Only when no label
4. `getByText` - Non-interactive elements
5. `getByDisplayValue` - Current form value
6. `getByAltText` - Images
7. `getByTitle` - Last choice
8. `getByTestId` - Only as last resort

### Async Debugging

```typescript
// Wait for element to appear
await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument()
})

// Wait for element to disappear
await waitFor(() => {
  expect(screen.queryByText('Loading')).not.toBeInTheDocument()
})

// Find async element
const element = await screen.findByText('Async Content')
```

## Reference Examples

Test examples in the project:
- [classnames.spec.ts](../utils/classnames.spec.ts) - Utility function tests
- [index.spec.tsx](../app/components/base/button/index.spec.tsx) - Component tests

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Testing Library Documentation](https://testing-library.com/docs/react-testing-library/intro/)
- [Testing Library Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Jest Mock Functions](https://jestjs.io/docs/mock-functions)

## FAQ

### Q: When to use `getBy` vs `queryBy` vs `findBy`?

- `getBy*`: Expect element to exist, throws error if not found
- `queryBy*`: Element may not exist, returns null if not found
- `findBy*`: Async query, returns Promise

### Q: How to test conditional rendering?

```typescript
it('should conditionally render content', () => {
  const { rerender } = render(<Component show={false} />)
  expect(screen.queryByText('Content')).not.toBeInTheDocument()
  
  rerender(<Component show={true} />)
  expect(screen.getByText('Content')).toBeInTheDocument()
})
```

### Q: How to test custom hooks?

```typescript
import { renderHook, act } from '@testing-library/react'

it('should update counter', () => {
  const { result } = renderHook(() => useCounter())
  
  act(() => {
    result.current.increment()
  })
  
  expect(result.current.count).toBe(1)
})
```

---

**Remember**: Writing tests is not just about coverage, but ensuring code quality and maintainability. Good tests should be clear, concise, and meaningful.
