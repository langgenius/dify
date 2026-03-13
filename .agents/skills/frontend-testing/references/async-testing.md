# Async Testing Guide

## Core Async Patterns

### 1. waitFor - Wait for Condition

```typescript
import { render, screen, waitFor } from '@testing-library/react'

it('should load and display data', async () => {
  render(<DataComponent />)
  
  // Wait for element to appear
  await waitFor(() => {
    expect(screen.getByText('Loaded Data')).toBeInTheDocument()
  })
})

it('should hide loading spinner after load', async () => {
  render(<DataComponent />)
  
  // Wait for element to disappear
  await waitFor(() => {
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  })
})
```

### 2. findBy\* - Async Queries

```typescript
it('should show user name after fetch', async () => {
  render(<UserProfile />)
  
  // findBy returns a promise, auto-waits up to 1000ms
  const userName = await screen.findByText('John Doe')
  expect(userName).toBeInTheDocument()
  
  // findByRole with options
  const button = await screen.findByRole('button', { name: /submit/i })
  expect(button).toBeEnabled()
})
```

### 3. userEvent for Async Interactions

```typescript
import userEvent from '@testing-library/user-event'

it('should submit form', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  
  render(<Form onSubmit={onSubmit} />)
  
  // userEvent methods are async
  await user.type(screen.getByLabelText('Email'), 'test@example.com')
  await user.click(screen.getByRole('button', { name: /submit/i }))
  
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith({ email: 'test@example.com' })
  })
})
```

## Fake Timers

### When to Use Fake Timers

- Testing components with `setTimeout`/`setInterval`
- Testing debounce/throttle behavior
- Testing animations or delayed transitions
- Testing polling or retry logic

### Basic Fake Timer Setup

```typescript
describe('Debounced Search', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should debounce search input', async () => {
    const onSearch = vi.fn()
    render(<SearchInput onSearch={onSearch} debounceMs={300} />)
    
    // Type in the input
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'query' } })
    
    // Search not called immediately
    expect(onSearch).not.toHaveBeenCalled()
    
    // Advance timers
    vi.advanceTimersByTime(300)
    
    // Now search is called
    expect(onSearch).toHaveBeenCalledWith('query')
  })
})
```

### Fake Timers with Async Code

```typescript
it('should retry on failure', async () => {
  vi.useFakeTimers()
  const fetchData = vi.fn()
    .mockRejectedValueOnce(new Error('Network error'))
    .mockResolvedValueOnce({ data: 'success' })
  
  render(<RetryComponent fetchData={fetchData} retryDelayMs={1000} />)
  
  // First call fails
  await waitFor(() => {
    expect(fetchData).toHaveBeenCalledTimes(1)
  })
  
  // Advance timer for retry
  vi.advanceTimersByTime(1000)
  
  // Second call succeeds
  await waitFor(() => {
    expect(fetchData).toHaveBeenCalledTimes(2)
    expect(screen.getByText('success')).toBeInTheDocument()
  })
  
  vi.useRealTimers()
})
```

### Common Fake Timer Utilities

```typescript
// Run all pending timers
vi.runAllTimers()

// Run only pending timers (not new ones created during execution)
vi.runOnlyPendingTimers()

// Advance by specific time
vi.advanceTimersByTime(1000)

// Get current fake time
Date.now()

// Clear all timers
vi.clearAllTimers()
```

## API Testing Patterns

### Loading → Success → Error States

```typescript
describe('DataFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading state', () => {
    mockedApi.fetchData.mockImplementation(() => new Promise(() => {})) // Never resolves
    
    render(<DataFetcher />)
    
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('should show data on success', async () => {
    mockedApi.fetchData.mockResolvedValue({ items: ['Item 1', 'Item 2'] })
    
    render(<DataFetcher />)
    
    // Use findBy* for multiple async elements (better error messages than waitFor with multiple assertions)
    const item1 = await screen.findByText('Item 1')
    const item2 = await screen.findByText('Item 2')
    expect(item1).toBeInTheDocument()
    expect(item2).toBeInTheDocument()
    
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument()
  })

  it('should show error on failure', async () => {
    mockedApi.fetchData.mockRejectedValue(new Error('Failed to fetch'))
    
    render(<DataFetcher />)
    
    await waitFor(() => {
      expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument()
    })
  })

  it('should retry on error', async () => {
    mockedApi.fetchData.mockRejectedValue(new Error('Network error'))
    
    render(<DataFetcher />)
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
    
    mockedApi.fetchData.mockResolvedValue({ items: ['Item 1'] })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    
    await waitFor(() => {
      expect(screen.getByText('Item 1')).toBeInTheDocument()
    })
  })
})
```

### Testing Mutations

```typescript
it('should submit form and show success', async () => {
  const user = userEvent.setup()
  mockedApi.createItem.mockResolvedValue({ id: '1', name: 'New Item' })
  
  render(<CreateItemForm />)
  
  await user.type(screen.getByLabelText('Name'), 'New Item')
  await user.click(screen.getByRole('button', { name: /create/i }))
  
  // Button should be disabled during submission
  expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled()
  
  await waitFor(() => {
    expect(screen.getByText(/created successfully/i)).toBeInTheDocument()
  })
  
  expect(mockedApi.createItem).toHaveBeenCalledWith({ name: 'New Item' })
})
```

## useEffect Testing

### Testing Effect Execution

```typescript
it('should fetch data on mount', async () => {
  const fetchData = vi.fn().mockResolvedValue({ data: 'test' })
  
  render(<ComponentWithEffect fetchData={fetchData} />)
  
  await waitFor(() => {
    expect(fetchData).toHaveBeenCalledTimes(1)
  })
})
```

### Testing Effect Dependencies

```typescript
it('should refetch when id changes', async () => {
  const fetchData = vi.fn().mockResolvedValue({ data: 'test' })
  
  const { rerender } = render(<ComponentWithEffect id="1" fetchData={fetchData} />)
  
  await waitFor(() => {
    expect(fetchData).toHaveBeenCalledWith('1')
  })
  
  rerender(<ComponentWithEffect id="2" fetchData={fetchData} />)
  
  await waitFor(() => {
    expect(fetchData).toHaveBeenCalledWith('2')
    expect(fetchData).toHaveBeenCalledTimes(2)
  })
})
```

### Testing Effect Cleanup

```typescript
it('should cleanup subscription on unmount', () => {
  const subscribe = vi.fn()
  const unsubscribe = vi.fn()
  subscribe.mockReturnValue(unsubscribe)
  
  const { unmount } = render(<SubscriptionComponent subscribe={subscribe} />)
  
  expect(subscribe).toHaveBeenCalledTimes(1)
  
  unmount()
  
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
```

## Common Async Pitfalls

### ❌ Don't: Forget to await

```typescript
// Bad - test may pass even if assertion fails
it('should load data', () => {
  render(<Component />)
  waitFor(() => {
    expect(screen.getByText('Data')).toBeInTheDocument()
  })
})

// Good - properly awaited
it('should load data', async () => {
  render(<Component />)
  await waitFor(() => {
    expect(screen.getByText('Data')).toBeInTheDocument()
  })
})
```

### ❌ Don't: Use multiple assertions in single waitFor

```typescript
// Bad - if first assertion fails, won't know about second
await waitFor(() => {
  expect(screen.getByText('Title')).toBeInTheDocument()
  expect(screen.getByText('Description')).toBeInTheDocument()
})

// Good - separate waitFor or use findBy
const title = await screen.findByText('Title')
const description = await screen.findByText('Description')
expect(title).toBeInTheDocument()
expect(description).toBeInTheDocument()
```

### ❌ Don't: Mix fake timers with real async

```typescript
// Bad - fake timers don't work well with real Promises
vi.useFakeTimers()
await waitFor(() => {
  expect(screen.getByText('Data')).toBeInTheDocument()
}) // May timeout!

// Good - use runAllTimers or advanceTimersByTime
vi.useFakeTimers()
render(<Component />)
vi.runAllTimers()
expect(screen.getByText('Data')).toBeInTheDocument()
```
