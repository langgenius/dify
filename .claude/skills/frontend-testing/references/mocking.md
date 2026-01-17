# Mocking Guide for Dify Frontend Tests

## ⚠️ Important: What NOT to Mock

### DO NOT Mock Base Components

**Never mock components from `@/app/components/base/`** such as:

- `Loading`, `Spinner`
- `Button`, `Input`, `Select`
- `Tooltip`, `Modal`, `Dropdown`
- `Icon`, `Badge`, `Tag`

**Why?**

- Base components will have their own dedicated tests
- Mocking them creates false positives (tests pass but real integration fails)
- Using real components tests actual integration behavior

```typescript
// ❌ WRONG: Don't mock base components
vi.mock('@/app/components/base/loading', () => () => <div>Loading</div>)
vi.mock('@/app/components/base/button', () => ({ children }: any) => <button>{children}</button>)

// ✅ CORRECT: Import and use real base components
import Loading from '@/app/components/base/loading'
import Button from '@/app/components/base/button'
// They will render normally in tests
```

### What TO Mock

Only mock these categories:

1. **API services** (`@/service/*`) - Network calls
1. **Complex context providers** - When setup is too difficult
1. **Third-party libraries with side effects** - `next/navigation`, external SDKs
1. **i18n** - Always mock to return keys

### Zustand Stores - DO NOT Mock Manually

**Zustand is globally mocked** in `web/vitest.setup.ts`. Use real stores with `setState()`:

```typescript
// ✅ CORRECT: Use real store, set test state
import { useAppStore } from '@/app/components/app/store'

useAppStore.setState({ appDetail: { id: 'test', name: 'Test' } })
render(<MyComponent />)

// ❌ WRONG: Don't mock the store module
vi.mock('@/app/components/app/store', () => ({ ... }))
```

See [Zustand Store Testing](#zustand-store-testing) section for full details.

## Mock Placement

| Location | Purpose |
|----------|---------|
| `web/vitest.setup.ts` | Global mocks shared by all tests (`react-i18next`, `next/image`, `zustand`) |
| `web/__mocks__/zustand.ts` | Zustand mock implementation (auto-resets stores after each test) |
| `web/__mocks__/` | Reusable mock factories shared across multiple test files |
| Test file | Test-specific mocks, inline with `vi.mock()` |

Modules are not mocked automatically. Use `vi.mock` in test files, or add global mocks in `web/vitest.setup.ts`.

**Note**: Zustand is special - it's globally mocked but you should NOT mock store modules manually. See [Zustand Store Testing](#zustand-store-testing).

## Essential Mocks

### 1. i18n (Auto-loaded via Global Mock)

A global mock is defined in `web/vitest.setup.ts` and is auto-loaded by Vitest setup.

The global mock provides:

- `useTranslation` - returns translation keys with namespace prefix
- `Trans` component - renders i18nKey and components
- `useMixedTranslation` (from `@/app/components/plugins/marketplace/hooks`)
- `useGetLanguage` (from `@/context/i18n`) - returns `'en-US'`

**Default behavior**: Most tests should use the global mock (no local override needed).

**For custom translations**: Use the helper function from `@/test/i18n-mock`:

```typescript
import { createReactI18nextMock } from '@/test/i18n-mock'

vi.mock('react-i18next', () => createReactI18nextMock({
  'my.custom.key': 'Custom translation',
  'button.save': 'Save',
}))
```

**Avoid**: Manually defining `useTranslation` mocks that just return the key - the global mock already does this.

### 2. Next.js Router

```typescript
const mockPush = vi.fn()
const mockReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/current-path',
  useSearchParams: () => new URLSearchParams('?key=value'),
}))

describe('Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should navigate on click', () => {
    render(<Component />)
    fireEvent.click(screen.getByRole('button'))
    expect(mockPush).toHaveBeenCalledWith('/expected-path')
  })
})
```

### 3. Portal Components (with Shared State)

```typescript
// ⚠️ Important: Use shared state for components that depend on each other
let mockPortalOpenState = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open, ...props }: any) => {
    mockPortalOpenState = open || false  // Update shared state
    return <div data-testid="portal" data-open={open}>{children}</div>
  },
  PortalToFollowElemContent: ({ children }: any) => {
    // ✅ Matches actual: returns null when portal is closed
    if (!mockPortalOpenState) return null
    return <div data-testid="portal-content">{children}</div>
  },
  PortalToFollowElemTrigger: ({ children }: any) => (
    <div data-testid="portal-trigger">{children}</div>
  ),
}))

describe('Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false  // ✅ Reset shared state
  })
})
```

### 4. API Service Mocks

```typescript
import * as api from '@/service/api'

vi.mock('@/service/api')

const mockedApi = vi.mocked(api)

describe('Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup default mock implementation
    mockedApi.fetchData.mockResolvedValue({ data: [] })
  })

  it('should show data on success', async () => {
    mockedApi.fetchData.mockResolvedValue({ data: [{ id: 1 }] })
    
    render(<Component />)
    
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument()
    })
  })

  it('should show error on failure', async () => {
    mockedApi.fetchData.mockRejectedValue(new Error('Network error'))
    
    render(<Component />)
    
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })
  })
})
```

### 5. HTTP Mocking with Nock

```typescript
import nock from 'nock'

const GITHUB_HOST = 'https://api.github.com'
const GITHUB_PATH = '/repos/owner/repo'

const mockGithubApi = (status: number, body: Record<string, unknown>, delayMs = 0) => {
  return nock(GITHUB_HOST)
    .get(GITHUB_PATH)
    .delay(delayMs)
    .reply(status, body)
}

describe('GithubComponent', () => {
  afterEach(() => {
    nock.cleanAll()
  })

  it('should display repo info', async () => {
    mockGithubApi(200, { name: 'dify', stars: 1000 })
    
    render(<GithubComponent />)
    
    await waitFor(() => {
      expect(screen.getByText('dify')).toBeInTheDocument()
    })
  })

  it('should handle API error', async () => {
    mockGithubApi(500, { message: 'Server error' })
    
    render(<GithubComponent />)
    
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })
  })
})
```

### 6. Context Providers

```typescript
import { ProviderContext } from '@/context/provider-context'
import { createMockProviderContextValue, createMockPlan } from '@/__mocks__/provider-context'

describe('Component with Context', () => {
  it('should render for free plan', () => {
    const mockContext = createMockPlan('sandbox')
    
    render(
      <ProviderContext.Provider value={mockContext}>
        <Component />
      </ProviderContext.Provider>
    )
    
    expect(screen.getByText('Upgrade')).toBeInTheDocument()
  })

  it('should render for pro plan', () => {
    const mockContext = createMockPlan('professional')
    
    render(
      <ProviderContext.Provider value={mockContext}>
        <Component />
      </ProviderContext.Provider>
    )
    
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument()
  })
})
```

### 7. React Query

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  )
}
```

## Mock Best Practices

### ✅ DO

1. **Use real base components** - Import from `@/app/components/base/` directly
1. **Use real project components** - Prefer importing over mocking
1. **Use real Zustand stores** - Set test state via `store.setState()`
1. **Reset mocks in `beforeEach`**, not `afterEach`
1. **Match actual component behavior** in mocks (when mocking is necessary)
1. **Use factory functions** for complex mock data
1. **Import actual types** for type safety
1. **Reset shared mock state** in `beforeEach`

### ❌ DON'T

1. **Don't mock base components** (`Loading`, `Button`, `Tooltip`, etc.)
1. **Don't mock Zustand store modules** - Use real stores with `setState()`
1. Don't mock components you can import directly
1. Don't create overly simplified mocks that miss conditional logic
1. Don't forget to clean up nock after each test
1. Don't use `any` types in mocks without necessity

### Mock Decision Tree

```
Need to use a component in test?
│
├─ Is it from @/app/components/base/*?
│  └─ YES → Import real component, DO NOT mock
│
├─ Is it a project component?
│  └─ YES → Prefer importing real component
│           Only mock if setup is extremely complex
│
├─ Is it an API service (@/service/*)?
│  └─ YES → Mock it
│
├─ Is it a third-party lib with side effects?
│  └─ YES → Mock it (next/navigation, external SDKs)
│
├─ Is it a Zustand store?
│  └─ YES → DO NOT mock the module!
│           Use real store + setState() to set test state
│           (Global mock handles auto-reset)
│
└─ Is it i18n?
   └─ YES → Uses shared mock (auto-loaded). Override only for custom translations
```

## Zustand Store Testing

### Global Zustand Mock (Auto-loaded)

Zustand is globally mocked in `web/vitest.setup.ts` following the [official Zustand testing guide](https://zustand.docs.pmnd.rs/guides/testing). The mock in `web/__mocks__/zustand.ts` provides:

- Real store behavior with `getState()`, `setState()`, `subscribe()` methods
- Automatic store reset after each test via `afterEach`
- Proper test isolation between tests

### ✅ Recommended: Use Real Stores (Official Best Practice)

**DO NOT mock store modules manually.** Import and use the real store, then use `setState()` to set test state:

```typescript
// ✅ CORRECT: Use real store with setState
import { useAppStore } from '@/app/components/app/store'

describe('MyComponent', () => {
  it('should render app details', () => {
    // Arrange: Set test state via setState
    useAppStore.setState({
      appDetail: {
        id: 'test-app',
        name: 'Test App',
        mode: 'chat',
      },
    })

    // Act
    render(<MyComponent />)

    // Assert
    expect(screen.getByText('Test App')).toBeInTheDocument()
    // Can also verify store state directly
    expect(useAppStore.getState().appDetail?.name).toBe('Test App')
  })

  // No cleanup needed - global mock auto-resets after each test
})
```

### ❌ Avoid: Manual Store Module Mocking

Manual mocking conflicts with the global Zustand mock and loses store functionality:

```typescript
// ❌ WRONG: Don't mock the store module
vi.mock('@/app/components/app/store', () => ({
  useStore: (selector) => mockSelector(selector),  // Missing getState, setState!
}))

// ❌ WRONG: This conflicts with global zustand mock
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: vi.fn(() => mockState),
}))
```

**Problems with manual mocking:**

1. Loses `getState()`, `setState()`, `subscribe()` methods
1. Conflicts with global Zustand mock behavior
1. Requires manual maintenance of store API
1. Tests don't reflect actual store behavior

### When Manual Store Mocking is Necessary

In rare cases where the store has complex initialization or side effects, you can mock it, but ensure you provide the full store API:

```typescript
// If you MUST mock (rare), include full store API
const mockStore = {
  appDetail: { id: 'test', name: 'Test' },
  setAppDetail: vi.fn(),
}

vi.mock('@/app/components/app/store', () => ({
  useStore: Object.assign(
    (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
    {
      getState: () => mockStore,
      setState: vi.fn(),
      subscribe: vi.fn(),
    },
  ),
}))
```

### Store Testing Decision Tree

```
Need to test a component using Zustand store?
│
├─ Can you use the real store?
│  └─ YES → Use real store + setState (RECOMMENDED)
│           useAppStore.setState({ ... })
│
├─ Does the store have complex initialization/side effects?
│  └─ YES → Consider mocking, but include full API
│           (getState, setState, subscribe)
│
└─ Are you testing the store itself (not a component)?
   └─ YES → Test store directly with getState/setState
            const store = useMyStore
            store.setState({ count: 0 })
            store.getState().increment()
            expect(store.getState().count).toBe(1)
```

### Example: Testing Store Actions

```typescript
import { useCounterStore } from '@/stores/counter'

describe('Counter Store', () => {
  it('should increment count', () => {
    // Initial state (auto-reset by global mock)
    expect(useCounterStore.getState().count).toBe(0)

    // Call action
    useCounterStore.getState().increment()

    // Verify state change
    expect(useCounterStore.getState().count).toBe(1)
  })

  it('should reset to initial state', () => {
    // Set some state
    useCounterStore.setState({ count: 100 })
    expect(useCounterStore.getState().count).toBe(100)

    // After this test, global mock will reset to initial state
  })
})
```

## Factory Function Pattern

```typescript
// __mocks__/data-factories.ts
import type { User, Project } from '@/types'

export const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'member',
  createdAt: new Date().toISOString(),
  ...overrides,
})

export const createMockProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: 'Test Project',
  description: 'A test project',
  owner: createMockUser(),
  members: [],
  createdAt: new Date().toISOString(),
  ...overrides,
})

// Usage in tests
it('should display project owner', () => {
  const project = createMockProject({
    owner: createMockUser({ name: 'John Doe' }),
  })
  
  render(<ProjectCard project={project} />)
  expect(screen.getByText('John Doe')).toBeInTheDocument()
})
```
