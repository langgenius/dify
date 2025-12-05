# Frontend Testing Guide

This document is the complete testing specification for the Dify frontend project.
Goal: Readable, change-friendly, reusable, and debuggable tests.
When I ask you to write/refactor/fix tests, follow these rules by default.

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
- **Script utilities**: `web/testing/analyze-component.js` analyzes component complexity and generates test prompts for AI assistants. Commands:
  - `pnpm analyze-component <path>` - Analyze and generate test prompt
  - `pnpm analyze-component <path> --json` - Output analysis as JSON
  - `pnpm analyze-component <path> --review` - Generate test review prompt
  - `pnpm analyze-component --help` - Show help
- **Integration suites**: Files in `web/__tests__/` exercise cross-component flows. Prefer adding new end-to-end style specs there rather than mixing them into component directories.

## Test Authoring Principles

- **Single behavior per test**: Each test verifies one user-observable behavior.
- **Black-box first**: Assert external behavior and observable outputs, avoid internal implementation details.
- **Semantic naming**: Use `should <behavior> when <condition>` and group related cases with `describe(<subject or scenario>)`.
- **AAA / Given–When–Then**: Separate Arrange, Act, and Assert clearly with code blocks or comments.
- **Minimal but sufficient assertions**: Keep only the expectations that express the essence of the behavior.
- **Reusable test data**: Prefer test data builders or factories over hard-coded masses of data.
- **De-flake**: Control time, randomness, network, concurrency, and ordering.
- **Fast & stable**: Keep unit tests running in milliseconds; reserve integration tests for cross-module behavior with isolation.
- **Structured describe blocks**: Organize tests with `describe` sections and add a brief comment before each block to explain the scenario it covers so readers can quickly understand the scope.

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

## Basic Guidelines

- ✅ AAA pattern: Arrange (setup) → Act (execute) → Assert (verify)
- ✅ Descriptive test names: `"should [behavior] when [condition]"`
- ✅ TypeScript: No `any` types
- ✅ **Cleanup**: `jest.clearAllMocks()` should be in `beforeEach()`, not `afterEach()`. This ensures mock call history is reset before each test, preventing test pollution when using assertions like `toHaveBeenCalledWith()` or `toHaveBeenCalledTimes()`.

**⚠️ Mock components must accurately reflect actual component behavior**, especially conditional rendering based on props or state.

**Rules**:

1. **Match actual conditional rendering**: If the real component returns `null` or doesn't render under certain conditions, the mock must do the same. Always check the actual component implementation before creating mocks.
1. **Use shared state variables when needed**: When mocking components that depend on shared context or state (e.g., `PortalToFollowElem` with `PortalToFollowElemContent`), use module-level variables to track state and reset them in `beforeEach`.
1. **Always reset shared mock state in beforeEach**: Module-level variables used in mocks must be reset in `beforeEach` to ensure test isolation, even if you set default values elsewhere.
1. **Use fake timers only when needed**: Only use `jest.useFakeTimers()` if:
   - Testing components that use real `setTimeout`/`setInterval` (not mocked)
   - Testing time-based behavior (delays, animations)
   - If you mock all time-dependent functions, fake timers are unnecessary
1. **Prefer importing over mocking project components**: When tests need other components from the project, import them directly instead of mocking them. Only mock external dependencies, APIs, or complex context providers that are difficult to set up.

**Why this matters**: Mocks that don't match actual behavior can lead to:

- **False positives**: Tests pass but code would fail in production
- **Missed bugs**: Tests don't catch real conditional rendering issues
- **Maintenance burden**: Tests become misleading documentation
- **State leakage**: Tests interfere with each other when shared state isn't reset

## Testing Components with Dedicated Dependencies

When a component has dedicated dependencies (custom hooks, managers, utilities) that are **only used by that component**, use the following strategy to balance integration testing and unit testing.

### Summary Checklist

When testing components with dedicated dependencies:

- **Identify** which dependencies are dedicated vs. reusable
- **Write integration tests** for component + dedicated dependencies together
- **Write unit tests** for complex edge cases in dependencies
- **Avoid mocking** dedicated dependencies in integration tests
- **Use fake timers** if timing logic is involved
- **Test user behavior**, not implementation details
- **Document** the testing strategy in code comments
- **Ensure** integration tests cover 100% of user-facing scenarios
- **Reserve** unit tests for edge cases not practical in integration tests

## Test Scenarios

Apply the following test scenarios based on component features:

### 1. Rendering Tests (REQUIRED - All Components)

**Key Points**:

- Verify component renders properly
- Check key elements exist
- Use semantic queries (getByRole, getByLabelText)

### 2. Props Testing (REQUIRED - All Components)

Exercise the prop combinations that change observable behavior. Show how required props gate functionality, how optional props fall back to their defaults, and how invalid combinations surface through user-facing safeguards. Let TypeScript catch structural issues; keep runtime assertions focused on what the component renders or triggers.

### 3. State Management

Treat component state as part of the public behavior: confirm the initial render in context, execute the interactions or prop updates that move the state machine, and assert the resulting UI or side effects. Use `waitFor()`/async queries whenever transitions resolve asynchronously, and only check cleanup paths when they change what a user sees or experiences (duplicate events, lingering timers, etc.).

#### Context, Providers, and Stores

- ✅ Wrap components with the actual provider from `web/context` or `app/components/.../context` whenever practical.
- ✅ When creating lightweight provider stubs, mirror the real default values and surface helper builders (for example `createMockWorkflowContext`).
- ✅ Reset shared stores (React context, Zustand, TanStack Query cache) between tests to avoid leaking state. Prefer helper factory functions over module-level singletons in specs.
- ✅ For hooks that read from context, use `renderHook` with a custom wrapper that supplies required providers.

### 4. Performance Optimization

Cover memoized callbacks or values only when they influence observable behavior—memoized children, subscription updates, expensive computations. Trigger realistic re-renders and assert the outcomes (avoided rerenders, reused results) instead of inspecting hook internals.

### 5. Event Handlers

Simulate the interactions that matter to users—primary clicks, change events, submits, and relevant keyboard shortcuts—and confirm the resulting behavior. When handlers prevent defaults or rely on bubbling, cover the scenarios where that choice affects the UI or downstream flows.

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

Mock the specific Next.js navigation hooks your component consumes (`useRouter`, `usePathname`, `useSearchParams`) and drive realistic routing flows—query parameters, redirects, guarded routes, URL updates—while asserting the rendered outcome or navigation side effects.

### 8. Edge Cases (REQUIRED - All Components)

**Must Test**:

- ✅ null/undefined/empty values
- ✅ Boundary conditions
- ✅ Error states
- ✅ Loading states
- ✅ Unexpected inputs

### 9. Test Data Builders (Anti-hardcoding)

For complex inputs/entities, use Builders with solid defaults and chainable overrides.

### 10. Accessibility Testing (Optional)

- Test keyboard navigation
- Verify ARIA attributes
- Test focus management
- Ensure screen reader compatibility

### 11. Snapshot Testing (Use Sparingly)

Reserve snapshots for static, deterministic fragments (icons, badges, layout chrome). Keep them tight, prefer explicit assertions for behavior, and review any snapshot updates deliberately instead of accepting them wholesale.

**Note**: Dify is a desktop application. **No need for** responsive/mobile testing.

### 12. Mock API

Use Nock to mock API calls. Example:

```ts
const mockGithubStar = (status: number, body: Record<string, unknown>, delayMs = 0) => {
  return nock(GITHUB_HOST).get(GITHUB_PATH).delay(delayMs).reply(status, body)
}
```

## Code Style

### Example Structure

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Component from './index'

// Mock dependencies
jest.mock('@/service/api')

// Shared state for mocks (if needed)
let mockSharedState = false

describe('ComponentName', () => {
  beforeEach(() => {
    jest.clearAllMocks()  // ✅ Reset mocks before each test
    mockSharedState = false  // ✅ Reset shared state if used in mocks
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

1. **Forms**: Test validation logic thoroughly

1. **Example - Correct mock with conditional rendering**:

```typescript
// ✅ CORRECT: Matches actual component behavior
let mockPortalOpenState = false

jest.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open, ...props }: any) => {
    mockPortalOpenState = open || false  // Update shared state
    return <div data-open={open}>{children}</div>
  },
  PortalToFollowElemContent: ({ children }: any) => {
    // ✅ Matches actual: returns null when open is false
    if (!mockPortalOpenState) return null
    return <div>{children}</div>
  },
}))

describe('Component', () => {
  beforeEach(() => {
    jest.clearAllMocks()  // ✅ Reset mock call history
    mockPortalOpenState = false  // ✅ Reset shared state
  })
})
```

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

### ⚠️ MANDATORY: Complete Coverage in Single Generation

Aim for 100% coverage:

- ✅ 100% function coverage (every exported function/method tested)
- ✅ 100% statement coverage (every line executed)
- ✅ >95% branch coverage (every if/else, switch case, ternary tested)
- ✅ >95% line coverage

Generate comprehensive tests covering **all** code paths and scenarios.

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
1. `getByLabelText` - Form fields
1. `getByPlaceholderText` - Only when no label
1. `getByText` - Non-interactive elements
1. `getByDisplayValue` - Current form value
1. `getByAltText` - Images
1. `getByTitle` - Last choice
1. `getByTestId` - Only as last resort

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

______________________________________________________________________

**Remember**: Writing tests is not just about coverage, but ensuring code quality and maintainability. Good tests should be clear, concise, and meaningful.
