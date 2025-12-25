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

## Mock Placement

| Location | Purpose |
|----------|---------|
| `web/vitest.setup.ts` | Global mocks shared by all tests (for example `react-i18next`, `next/image`) |
| `web/__mocks__/` | Reusable mock factories shared across multiple test files |
| Test file | Test-specific mocks, inline with `vi.mock()` |

Modules are not mocked automatically. Use `vi.mock` in test files, or add global mocks in `web/vitest.setup.ts`.

## Essential Mocks

### 1. i18n (Auto-loaded via Global Mock)

A global mock is defined in `web/vitest.setup.ts` and is auto-loaded by Vitest setup.
**No explicit mock needed** for most tests - it returns translation keys as-is.

For tests requiring custom translations, override the mock:

```typescript
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'my.custom.key': 'Custom translation',
      }
      return translations[key] || key
    },
  }),
}))
```

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
1. **Reset mocks in `beforeEach`**, not `afterEach`
1. **Match actual component behavior** in mocks (when mocking is necessary)
1. **Use factory functions** for complex mock data
1. **Import actual types** for type safety
1. **Reset shared mock state** in `beforeEach`

### ❌ DON'T

1. **Don't mock base components** (`Loading`, `Button`, `Tooltip`, etc.)
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
└─ Is it i18n?
   └─ YES → Uses shared mock (auto-loaded). Override only for custom translations
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
