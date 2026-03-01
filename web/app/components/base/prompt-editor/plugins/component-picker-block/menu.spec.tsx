import { render } from '@testing-library/react'
import { Fragment } from 'react'
import { PickerBlockMenuOption } from './menu'

describe('PickerBlockMenuOption', () => {
  // Define the render props type locally to match the component's internal type accurately
  type MenuOptionRenderProps = {
    isSelected: boolean
    onSelect: () => void
    onSetHighlight: () => void
    queryString: string | null
  }

  const mockRender = vi.fn((props: MenuOptionRenderProps) => (
    <div data-testid="menu-item">
      {props.isSelected ? 'Selected' : 'Not Selected'}
      {props.queryString && ` Query: ${props.queryString}`}
    </div>
  ))
  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Constructor and Initialization', () => {
    it('should correctly initialize with provided key and group', () => {
      const option = new PickerBlockMenuOption({
        key: 'test-key',
        group: 'test-group',
        render: mockRender,
      })

      // Check inheritance from MenuOption (key)
      expect(option.key).toBe('test-key')
      // Check custom property (group)
      expect(option.group).toBe('test-group')
    })

    it('should initialize without group when not provided', () => {
      const option = new PickerBlockMenuOption({
        key: 'test-key-no-group',
        render: mockRender,
      })

      expect(option.key).toBe('test-key-no-group')
      expect(option.group).toBeUndefined()
    })
  })

  describe('onSelectMenuOption', () => {
    it('should call the provided onSelect callback', () => {
      const option = new PickerBlockMenuOption({
        key: 'test-key',
        onSelect: mockOnSelect,
        render: mockRender,
      })

      option.onSelectMenuOption()
      expect(mockOnSelect).toHaveBeenCalledTimes(1)
    })

    it('should handle cases where onSelect is not provided (optional chaining)', () => {
      const option = new PickerBlockMenuOption({
        key: 'test-key',
        render: mockRender,
      })

      // This covers the branch where this.data.onSelect is undefined
      expect(() => option.onSelectMenuOption()).not.toThrow()
    })
  })

  describe('renderMenuOption', () => {
    it('should call the render function with correct props and return the element', () => {
      const option = new PickerBlockMenuOption({
        key: 'test-key',
        render: mockRender,
      })

      const renderProps: MenuOptionRenderProps = {
        isSelected: true,
        onSelect: vi.fn(),
        onSetHighlight: vi.fn(),
        queryString: 'search-string',
      }

      // Execute renderMenuOption
      const renderedElement = option.renderMenuOption(renderProps)

      // Use RTL to verify the rendered output
      const { getByTestId, getByText } = render(renderedElement)

      // Assertions
      expect(mockRender).toHaveBeenCalledWith(renderProps)
      expect(getByTestId('menu-item')).toBeInTheDocument()
      expect(getByText('Selected Query: search-string')).toBeInTheDocument()
    })

    it('should use Fragment with the correct key as the wrapper', () => {
      // In React testing, verifying the key of a Fragment directly from the element can be tricky,
      // but we can verify the structure and that it renders correctly.
      const option = new PickerBlockMenuOption({
        key: 'fragment-key',
        render: mockRender,
      })

      const renderProps: MenuOptionRenderProps = {
        isSelected: false,
        onSelect: vi.fn(),
        onSetHighlight: vi.fn(),
        queryString: null,
      }

      const element = option.renderMenuOption(renderProps)

      // Verify the element type is Fragment (rendered output doesn't show Fragment in DOM)
      // but we can check the JSX structure if needed.
      expect(element.type).toBe(Fragment)
      expect(element.key).toBe('fragment-key')
    })
  })
})
