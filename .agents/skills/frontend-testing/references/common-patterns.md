# Common Testing Patterns

## Query Priority

Use queries in this order (most to least preferred):

```typescript
// 1. getByRole - Most recommended (accessibility)
screen.getByRole('button', { name: /submit/i })
screen.getByRole('textbox', { name: /email/i })
screen.getByRole('heading', { level: 1 })

// 2. getByLabelText - Form fields
screen.getByLabelText('Email address')
screen.getByLabelText(/password/i)

// 3. getByPlaceholderText - When no label
screen.getByPlaceholderText('Search...')

// 4. getByText - Non-interactive elements
screen.getByText('Welcome to Dify')
screen.getByText(/loading/i)

// 5. getByDisplayValue - Current input value
screen.getByDisplayValue('current value')

// 6. getByAltText - Images
screen.getByAltText('Company logo')

// 7. getByTitle - Tooltip elements
screen.getByTitle('Close')

// 8. getByTestId - Last resort only!
screen.getByTestId('custom-element')
```

## Event Handling Patterns

### Click Events

```typescript
// Basic click
fireEvent.click(screen.getByRole('button'))

// With userEvent (preferred for realistic interaction)
const user = userEvent.setup()
await user.click(screen.getByRole('button'))

// Double click
await user.dblClick(screen.getByRole('button'))

// Right click
await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button') })
```

### Form Input

```typescript
const user = userEvent.setup()

// Type in input
await user.type(screen.getByRole('textbox'), 'Hello World')

// Clear and type
await user.clear(screen.getByRole('textbox'))
await user.type(screen.getByRole('textbox'), 'New value')

// Select option
await user.selectOptions(screen.getByRole('combobox'), 'option-value')

// Check checkbox
await user.click(screen.getByRole('checkbox'))

// Upload file
const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
await user.upload(screen.getByLabelText(/upload/i), file)
```

### Keyboard Events

```typescript
const user = userEvent.setup()

// Press Enter
await user.keyboard('{Enter}')

// Press Escape
await user.keyboard('{Escape}')

// Keyboard shortcut
await user.keyboard('{Control>}a{/Control}') // Ctrl+A

// Tab navigation
await user.tab()

// Arrow keys
await user.keyboard('{ArrowDown}')
await user.keyboard('{ArrowUp}')
```

## Component State Testing

### Testing State Transitions

```typescript
describe('Counter', () => {
  it('should increment count', async () => {
    const user = userEvent.setup()
    render(<Counter initialCount={0} />)
    
    // Initial state
    expect(screen.getByText('Count: 0')).toBeInTheDocument()
    
    // Trigger transition
    await user.click(screen.getByRole('button', { name: /increment/i }))
    
    // New state
    expect(screen.getByText('Count: 1')).toBeInTheDocument()
  })
})
```

### Testing Controlled Components

```typescript
describe('ControlledInput', () => {
  it('should call onChange with new value', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    
    render(<ControlledInput value="" onChange={handleChange} />)
    
    await user.type(screen.getByRole('textbox'), 'a')
    
    expect(handleChange).toHaveBeenCalledWith('a')
  })

  it('should display controlled value', () => {
    render(<ControlledInput value="controlled" onChange={vi.fn()} />)
    
    expect(screen.getByRole('textbox')).toHaveValue('controlled')
  })
})
```

## Conditional Rendering Testing

```typescript
describe('ConditionalComponent', () => {
  it('should show loading state', () => {
    render(<DataDisplay isLoading={true} data={null} />)
    
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(screen.queryByTestId('data-content')).not.toBeInTheDocument()
  })

  it('should show error state', () => {
    render(<DataDisplay isLoading={false} data={null} error="Failed to load" />)
    
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
  })

  it('should show data when loaded', () => {
    render(<DataDisplay isLoading={false} data={{ name: 'Test' }} />)
    
    expect(screen.getByText('Test')).toBeInTheDocument()
  })

  it('should show empty state when no data', () => {
    render(<DataDisplay isLoading={false} data={[]} />)
    
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
```

## List Rendering Testing

```typescript
describe('ItemList', () => {
  const items = [
    { id: '1', name: 'Item 1' },
    { id: '2', name: 'Item 2' },
    { id: '3', name: 'Item 3' },
  ]

  it('should render all items', () => {
    render(<ItemList items={items} />)
    
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    items.forEach(item => {
      expect(screen.getByText(item.name)).toBeInTheDocument()
    })
  })

  it('should handle item selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    
    render(<ItemList items={items} onSelect={onSelect} />)
    
    await user.click(screen.getByText('Item 2'))
    
    expect(onSelect).toHaveBeenCalledWith(items[1])
  })

  it('should handle empty list', () => {
    render(<ItemList items={[]} />)
    
    expect(screen.getByText(/no items/i)).toBeInTheDocument()
  })
})
```

## Modal/Dialog Testing

```typescript
describe('Modal', () => {
  it('should not render when closed', () => {
    render(<Modal isOpen={false} onClose={vi.fn()} />)
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should render when open', () => {
    render(<Modal isOpen={true} onClose={vi.fn()} />)
    
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('should call onClose when clicking overlay', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    
    render(<Modal isOpen={true} onClose={handleClose} />)
    
    await user.click(screen.getByTestId('modal-overlay'))
    
    expect(handleClose).toHaveBeenCalled()
  })

  it('should call onClose when pressing Escape', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    
    render(<Modal isOpen={true} onClose={handleClose} />)
    
    await user.keyboard('{Escape}')
    
    expect(handleClose).toHaveBeenCalled()
  })

  it('should trap focus inside modal', async () => {
    const user = userEvent.setup()
    
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <button>First</button>
        <button>Second</button>
      </Modal>
    )
    
    // Focus should cycle within modal
    await user.tab()
    expect(screen.getByText('First')).toHaveFocus()
    
    await user.tab()
    expect(screen.getByText('Second')).toHaveFocus()
    
    await user.tab()
    expect(screen.getByText('First')).toHaveFocus() // Cycles back
  })
})
```

## Form Testing

```typescript
describe('LoginForm', () => {
  it('should submit valid form', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    
    render(<LoginForm onSubmit={onSubmit} />)
    
    await user.type(screen.getByLabelText(/email/i), 'test@example.com')
    await user.type(screen.getByLabelText(/password/i), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    })
  })

  it('should show validation errors', async () => {
    const user = userEvent.setup()
    
    render(<LoginForm onSubmit={vi.fn()} />)
    
    // Submit empty form
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    
    expect(screen.getByText(/email is required/i)).toBeInTheDocument()
    expect(screen.getByText(/password is required/i)).toBeInTheDocument()
  })

  it('should validate email format', async () => {
    const user = userEvent.setup()
    
    render(<LoginForm onSubmit={vi.fn()} />)
    
    await user.type(screen.getByLabelText(/email/i), 'invalid-email')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    
    expect(screen.getByText(/invalid email/i)).toBeInTheDocument()
  })

  it('should disable submit button while submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)))
    
    render(<LoginForm onSubmit={onSubmit} />)
    
    await user.type(screen.getByLabelText(/email/i), 'test@example.com')
    await user.type(screen.getByLabelText(/password/i), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled()
    })
  })
})
```

## Data-Driven Tests with test.each

```typescript
describe('StatusBadge', () => {
  test.each([
    ['success', 'bg-green-500'],
    ['warning', 'bg-yellow-500'],
    ['error', 'bg-red-500'],
    ['info', 'bg-blue-500'],
  ])('should apply correct class for %s status', (status, expectedClass) => {
    render(<StatusBadge status={status} />)
    
    expect(screen.getByTestId('status-badge')).toHaveClass(expectedClass)
  })

  test.each([
    { input: null, expected: 'Unknown' },
    { input: undefined, expected: 'Unknown' },
    { input: '', expected: 'Unknown' },
    { input: 'invalid', expected: 'Unknown' },
  ])('should show "Unknown" for invalid input: $input', ({ input, expected }) => {
    render(<StatusBadge status={input} />)
    
    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})
```

## Debugging Tips

```typescript
// Print entire DOM
screen.debug()

// Print specific element
screen.debug(screen.getByRole('button'))

// Log testing playground URL
screen.logTestingPlaygroundURL()

// Pretty print DOM
import { prettyDOM } from '@testing-library/react'
console.log(prettyDOM(screen.getByRole('dialog')))

// Check available roles
import { getRoles } from '@testing-library/react'
console.log(getRoles(container))
```

## Common Mistakes to Avoid

### ❌ Don't Use Implementation Details

```typescript
// Bad - testing implementation
expect(component.state.isOpen).toBe(true)
expect(wrapper.find('.internal-class').length).toBe(1)

// Good - testing behavior
expect(screen.getByRole('dialog')).toBeInTheDocument()
```

### ❌ Don't Forget Cleanup

```typescript
// Bad - may leak state between tests
it('test 1', () => {
  render(<Component />)
})

// Good - cleanup is automatic with RTL, but reset mocks
beforeEach(() => {
  vi.clearAllMocks()
})
```

### ❌ Don't Use Exact String Matching (Prefer Black-Box Assertions)

```typescript
// ❌ Bad - hardcoded strings are brittle
expect(screen.getByText('Submit Form')).toBeInTheDocument()
expect(screen.getByText('Loading...')).toBeInTheDocument()

// ✅ Good - role-based queries (most semantic)
expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
expect(screen.getByRole('status')).toBeInTheDocument()

// ✅ Good - pattern matching (flexible)
expect(screen.getByText(/submit/i)).toBeInTheDocument()
expect(screen.getByText(/loading/i)).toBeInTheDocument()

// ✅ Good - test behavior, not exact UI text
expect(screen.getByRole('button')).toBeDisabled()
expect(screen.getByRole('alert')).toBeInTheDocument()
```

**Why prefer black-box assertions?**

- Text content may change (i18n, copy updates)
- Role-based queries test accessibility
- Pattern matching is resilient to minor changes
- Tests focus on behavior, not implementation details

### ❌ Don't Assert on Absence Without Query

```typescript
// Bad - throws if not found
expect(screen.getByText('Error')).not.toBeInTheDocument() // Error!

// Good - use queryBy for absence assertions
expect(screen.queryByText('Error')).not.toBeInTheDocument()
```
