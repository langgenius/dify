import type { Item } from './index'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Select, { PortalSelect, SimpleSelect } from './index'

const items: Item[] = [
  { value: 'apple', name: 'Apple' },
  { value: 'banana', name: 'Banana' },
  { value: 'citrus', name: 'Citrus' },
]

describe('Select', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering and edge behavior for default select.
  describe('Rendering', () => {
    it('should show the default selected item when defaultValue matches an item', () => {
      render(
        <Select
          items={items}
          defaultValue="banana"
          allowSearch={false}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByTitle('Banana')).toBeInTheDocument()
    })
  })

  // User interactions for default select.
  describe('User Interactions', () => {
    it('should call onSelect when choosing an option from default select', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <Select
          items={items}
          defaultValue="banana"
          allowSearch={false}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByTitle('Banana'))
      await user.click(screen.getByText('Citrus'))

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
        value: 'citrus',
        name: 'Citrus',
      }))
    })

    it('should not open or select when default select is disabled', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <Select
          items={items}
          defaultValue="banana"
          allowSearch={false}
          disabled={true}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByTitle('Banana'))

      expect(screen.queryByText('Citrus')).not.toBeInTheDocument()
      expect(onSelect).not.toHaveBeenCalled()
    })
  })
})

describe('SimpleSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering and placeholder fallback behavior.
  describe('Rendering', () => {
    it('should render i18n placeholder when no selection exists', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="missing"
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText(/select/i)).toBeInTheDocument()
    })

    it('should render custom placeholder when provided', () => {
      render(
        <SimpleSelect
          items={items}
          defaultValue="missing"
          placeholder="Pick one"
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('Pick one')).toBeInTheDocument()
    })
  })

  // User interactions and callback behavior.
  describe('User Interactions', () => {
    it('should call onSelect and update display when an option is chosen', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <SimpleSelect
          items={items}
          defaultValue="missing"
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('Apple'))

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
        value: 'apple',
        name: 'Apple',
      }))
      expect(screen.getByText('Apple')).toBeInTheDocument()
    })

    it('should pass open state into renderTrigger', async () => {
      const user = userEvent.setup()

      render(
        <SimpleSelect
          items={items}
          defaultValue="missing"
          onSelect={vi.fn()}
          renderTrigger={(selected, open) => (
            <span>{`${selected?.name ?? 'none'}-${open ? 'open' : 'closed'}`}</span>
          )}
        />,
      )

      expect(screen.getByText('none-closed')).toBeInTheDocument()
      await user.click(screen.getByText('none-closed'))
      expect(screen.getByText('none-open')).toBeInTheDocument()
    })
  })
})

describe('PortalSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering for edge case when value is empty.
  describe('Rendering', () => {
    it('should show placeholder when value is empty', () => {
      render(
        <PortalSelect
          value=""
          items={items}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText(/select/i)).toBeInTheDocument()
    })
  })

  // Interaction and readonly behavior.
  describe('User Interactions', () => {
    it('should call onSelect when choosing an option from portal dropdown', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <PortalSelect
          value=""
          items={items}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByText(/select/i))
      await user.click(screen.getByText('Citrus'))

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
        value: 'citrus',
        name: 'Citrus',
      }))
    })

    it('should not open the portal dropdown when readonly is true', async () => {
      const user = userEvent.setup()

      render(
        <PortalSelect
          value=""
          items={items}
          readonly={true}
          onSelect={vi.fn()}
        />,
      )

      await user.click(screen.getByText(/select/i))
      expect(screen.queryByTitle('Citrus')).not.toBeInTheDocument()
    })
  })
})
