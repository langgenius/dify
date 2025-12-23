import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CrawledResult from './base/crawled-result'
import CrawledResultItem from './base/crawled-result-item'
import Header from './base/header'
import Input from './base/input'

// ============================================================================
// Test Data Factories
// ============================================================================

const createCrawlResultItem = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page Title',
  markdown: '# Test Content',
  description: 'Test description',
  source_url: 'https://example.com/page',
  ...overrides,
})

// ============================================================================
// Input Component Tests
// ============================================================================

describe('Input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createInputProps = (overrides: Partial<Parameters<typeof Input>[0]> = {}) => ({
    value: '',
    onChange: vi.fn(),
    ...overrides,
  })

  describe('Rendering', () => {
    it('should render text input by default', () => {
      const props = createInputProps()
      render(<Input {...props} />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'text')
    })

    it('should render number input when isNumber is true', () => {
      const props = createInputProps({ isNumber: true, value: 0 })
      render(<Input {...props} />)

      const input = screen.getByRole('spinbutton')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'number')
      expect(input).toHaveAttribute('min', '0')
    })

    it('should render with placeholder', () => {
      const props = createInputProps({ placeholder: 'Enter URL' })
      render(<Input {...props} />)

      expect(screen.getByPlaceholderText('Enter URL')).toBeInTheDocument()
    })

    it('should render with initial value', () => {
      const props = createInputProps({ value: 'test value' })
      render(<Input {...props} />)

      expect(screen.getByDisplayValue('test value')).toBeInTheDocument()
    })
  })

  describe('Text Input Behavior', () => {
    it('should call onChange with string value for text input', async () => {
      const onChange = vi.fn()
      const props = createInputProps({ onChange })

      render(<Input {...props} />)
      const input = screen.getByRole('textbox')

      await userEvent.type(input, 'hello')

      expect(onChange).toHaveBeenCalledWith('h')
      expect(onChange).toHaveBeenCalledWith('e')
      expect(onChange).toHaveBeenCalledWith('l')
      expect(onChange).toHaveBeenCalledWith('l')
      expect(onChange).toHaveBeenCalledWith('o')
    })
  })

  describe('Number Input Behavior', () => {
    it('should call onChange with parsed integer for number input', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 0 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '42' } })

      expect(onChange).toHaveBeenCalledWith(42)
    })

    it('should call onChange with empty string when input is NaN', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 0 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: 'abc' } })

      expect(onChange).toHaveBeenCalledWith('')
    })

    it('should call onChange with empty string when input is empty', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 5 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '' } })

      expect(onChange).toHaveBeenCalledWith('')
    })

    it('should clamp negative values to MIN_VALUE (0)', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 0 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '-5' } })

      expect(onChange).toHaveBeenCalledWith(0)
    })

    it('should handle decimal input by parsing as integer', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 0 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '3.7' } })

      expect(onChange).toHaveBeenCalledWith(3)
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(Input.$$typeof).toBeDefined()
    })
  })
})

// ============================================================================
// Header Component Tests
// ============================================================================

describe('Header', () => {
  const createHeaderProps = (overrides: Partial<Parameters<typeof Header>[0]> = {}) => ({
    title: 'Test Title',
    docTitle: 'Documentation',
    docLink: 'https://docs.example.com',
    ...overrides,
  })

  describe('Rendering', () => {
    it('should render title', () => {
      const props = createHeaderProps()
      render(<Header {...props} />)

      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should render doc link', () => {
      const props = createHeaderProps()
      render(<Header {...props} />)

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://docs.example.com')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('should render button text when not in pipeline', () => {
      const props = createHeaderProps({ buttonText: 'Configure' })
      render(<Header {...props} />)

      expect(screen.getByText('Configure')).toBeInTheDocument()
    })

    it('should not render button text when in pipeline', () => {
      const props = createHeaderProps({ isInPipeline: true, buttonText: 'Configure' })
      render(<Header {...props} />)

      expect(screen.queryByText('Configure')).not.toBeInTheDocument()
    })
  })

  describe('isInPipeline Prop', () => {
    it('should apply pipeline styles when isInPipeline is true', () => {
      const props = createHeaderProps({ isInPipeline: true })
      render(<Header {...props} />)

      const titleElement = screen.getByText('Test Title')
      expect(titleElement).toHaveClass('system-sm-semibold')
    })

    it('should apply default styles when isInPipeline is false', () => {
      const props = createHeaderProps({ isInPipeline: false })
      render(<Header {...props} />)

      const titleElement = screen.getByText('Test Title')
      expect(titleElement).toHaveClass('system-md-semibold')
    })

    it('should apply compact button styles when isInPipeline is true', () => {
      const props = createHeaderProps({ isInPipeline: true })
      render(<Header {...props} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('size-6')
      expect(button).toHaveClass('px-1')
    })

    it('should apply default button styles when isInPipeline is false', () => {
      const props = createHeaderProps({ isInPipeline: false })
      render(<Header {...props} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('gap-x-0.5')
      expect(button).toHaveClass('px-1.5')
    })
  })

  describe('User Interactions', () => {
    it('should call onClickConfiguration when button is clicked', async () => {
      const onClickConfiguration = vi.fn()
      const props = createHeaderProps({ onClickConfiguration })

      render(<Header {...props} />)
      await userEvent.click(screen.getByRole('button'))

      expect(onClickConfiguration).toHaveBeenCalledTimes(1)
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(Header.$$typeof).toBeDefined()
    })
  })
})

// ============================================================================
// CrawledResultItem Component Tests
// ============================================================================

describe('CrawledResultItem', () => {
  const createItemProps = (overrides: Partial<Parameters<typeof CrawledResultItem>[0]> = {}) => ({
    payload: createCrawlResultItem(),
    isChecked: false,
    isPreview: false,
    onCheckChange: vi.fn(),
    onPreview: vi.fn(),
    testId: 'test-item',
    ...overrides,
  })

  describe('Rendering', () => {
    it('should render title and source URL', () => {
      const props = createItemProps({
        payload: createCrawlResultItem({
          title: 'My Page',
          source_url: 'https://mysite.com',
        }),
      })
      render(<CrawledResultItem {...props} />)

      expect(screen.getByText('My Page')).toBeInTheDocument()
      expect(screen.getByText('https://mysite.com')).toBeInTheDocument()
    })

    it('should render checkbox (custom Checkbox component)', () => {
      const props = createItemProps()
      render(<CrawledResultItem {...props} />)

      // Find checkbox by data-testid
      const checkbox = screen.getByTestId('checkbox-test-item')
      expect(checkbox).toBeInTheDocument()
    })

    it('should render preview button', () => {
      const props = createItemProps()
      render(<CrawledResultItem {...props} />)

      expect(screen.getByText('datasetCreation.stepOne.website.preview')).toBeInTheDocument()
    })
  })

  describe('Checkbox Behavior', () => {
    it('should call onCheckChange with true when unchecked item is clicked', async () => {
      const onCheckChange = vi.fn()
      const props = createItemProps({ isChecked: false, onCheckChange })

      render(<CrawledResultItem {...props} />)
      const checkbox = screen.getByTestId('checkbox-test-item')
      await userEvent.click(checkbox)

      expect(onCheckChange).toHaveBeenCalledWith(true)
    })

    it('should call onCheckChange with false when checked item is clicked', async () => {
      const onCheckChange = vi.fn()
      const props = createItemProps({ isChecked: true, onCheckChange })

      render(<CrawledResultItem {...props} />)
      const checkbox = screen.getByTestId('checkbox-test-item')
      await userEvent.click(checkbox)

      expect(onCheckChange).toHaveBeenCalledWith(false)
    })
  })

  describe('Preview Behavior', () => {
    it('should call onPreview when preview button is clicked', async () => {
      const onPreview = vi.fn()
      const props = createItemProps({ onPreview })

      render(<CrawledResultItem {...props} />)
      await userEvent.click(screen.getByText('datasetCreation.stepOne.website.preview'))

      expect(onPreview).toHaveBeenCalledTimes(1)
    })

    it('should apply active style when isPreview is true', () => {
      const props = createItemProps({ isPreview: true })
      const { container } = render(<CrawledResultItem {...props} />)

      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('bg-state-base-active')
    })

    it('should not apply active style when isPreview is false', () => {
      const props = createItemProps({ isPreview: false })
      const { container } = render(<CrawledResultItem {...props} />)

      const wrapper = container.firstChild
      expect(wrapper).not.toHaveClass('bg-state-base-active')
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(CrawledResultItem.$$typeof).toBeDefined()
    })
  })
})

// ============================================================================
// CrawledResult Component Tests
// ============================================================================

describe('CrawledResult', () => {
  const createResultProps = (overrides: Partial<Parameters<typeof CrawledResult>[0]> = {}) => ({
    list: [
      createCrawlResultItem({ source_url: 'https://page1.com', title: 'Page 1' }),
      createCrawlResultItem({ source_url: 'https://page2.com', title: 'Page 2' }),
      createCrawlResultItem({ source_url: 'https://page3.com', title: 'Page 3' }),
    ],
    checkedList: [],
    onSelectedChange: vi.fn(),
    onPreview: vi.fn(),
    usedTime: 2.5,
    ...overrides,
  })

  // Helper functions to get checkboxes by data-testid
  const getSelectAllCheckbox = () => screen.getByTestId('checkbox-select-all')
  const getItemCheckbox = (index: number) => screen.getByTestId(`checkbox-item-${index}`)

  describe('Rendering', () => {
    it('should render all items in list', () => {
      const props = createResultProps()
      render(<CrawledResult {...props} />)

      expect(screen.getByText('Page 1')).toBeInTheDocument()
      expect(screen.getByText('Page 2')).toBeInTheDocument()
      expect(screen.getByText('Page 3')).toBeInTheDocument()
    })

    it('should render time info', () => {
      const props = createResultProps({ usedTime: 3.456 })
      render(<CrawledResult {...props} />)

      // The component uses i18n, so we check for the key pattern
      expect(screen.getByText(/scrapTimeInfo/)).toBeInTheDocument()
    })

    it('should render select all checkbox', () => {
      const props = createResultProps()
      render(<CrawledResult {...props} />)

      expect(screen.getByText('datasetCreation.stepOne.website.selectAll')).toBeInTheDocument()
    })

    it('should render reset all when all items are checked', () => {
      const list = [
        createCrawlResultItem({ source_url: 'https://page1.com' }),
        createCrawlResultItem({ source_url: 'https://page2.com' }),
      ]
      const props = createResultProps({ list, checkedList: list })
      render(<CrawledResult {...props} />)

      expect(screen.getByText('datasetCreation.stepOne.website.resetAll')).toBeInTheDocument()
    })
  })

  describe('Select All / Deselect All', () => {
    it('should call onSelectedChange with all items when select all is clicked', async () => {
      const onSelectedChange = vi.fn()
      const list = [
        createCrawlResultItem({ source_url: 'https://page1.com' }),
        createCrawlResultItem({ source_url: 'https://page2.com' }),
      ]
      const props = createResultProps({ list, checkedList: [], onSelectedChange })

      render(<CrawledResult {...props} />)
      await userEvent.click(getSelectAllCheckbox())

      expect(onSelectedChange).toHaveBeenCalledWith(list)
    })

    it('should call onSelectedChange with empty array when reset all is clicked', async () => {
      const onSelectedChange = vi.fn()
      const list = [
        createCrawlResultItem({ source_url: 'https://page1.com' }),
        createCrawlResultItem({ source_url: 'https://page2.com' }),
      ]
      const props = createResultProps({ list, checkedList: list, onSelectedChange })

      render(<CrawledResult {...props} />)
      await userEvent.click(getSelectAllCheckbox())

      expect(onSelectedChange).toHaveBeenCalledWith([])
    })
  })

  describe('Individual Item Selection', () => {
    it('should add item to checkedList when unchecked item is checked', async () => {
      const onSelectedChange = vi.fn()
      const list = [
        createCrawlResultItem({ source_url: 'https://page1.com', title: 'Page 1' }),
        createCrawlResultItem({ source_url: 'https://page2.com', title: 'Page 2' }),
      ]
      const props = createResultProps({ list, checkedList: [], onSelectedChange })

      render(<CrawledResult {...props} />)
      await userEvent.click(getItemCheckbox(0))

      expect(onSelectedChange).toHaveBeenCalledWith([list[0]])
    })

    it('should remove item from checkedList when checked item is unchecked', async () => {
      const onSelectedChange = vi.fn()
      const list = [
        createCrawlResultItem({ source_url: 'https://page1.com', title: 'Page 1' }),
        createCrawlResultItem({ source_url: 'https://page2.com', title: 'Page 2' }),
      ]
      const props = createResultProps({ list, checkedList: [list[0]], onSelectedChange })

      render(<CrawledResult {...props} />)
      await userEvent.click(getItemCheckbox(0))

      expect(onSelectedChange).toHaveBeenCalledWith([])
    })

    it('should preserve other checked items when unchecking one item', async () => {
      const onSelectedChange = vi.fn()
      const list = [
        createCrawlResultItem({ source_url: 'https://page1.com', title: 'Page 1' }),
        createCrawlResultItem({ source_url: 'https://page2.com', title: 'Page 2' }),
        createCrawlResultItem({ source_url: 'https://page3.com', title: 'Page 3' }),
      ]
      const props = createResultProps({ list, checkedList: [list[0], list[1]], onSelectedChange })

      render(<CrawledResult {...props} />)
      // Click the first item's checkbox to uncheck it
      await userEvent.click(getItemCheckbox(0))

      expect(onSelectedChange).toHaveBeenCalledWith([list[1]])
    })
  })

  describe('Preview Behavior', () => {
    it('should call onPreview with correct item when preview is clicked', async () => {
      const onPreview = vi.fn()
      const list = [
        createCrawlResultItem({ source_url: 'https://page1.com', title: 'Page 1' }),
        createCrawlResultItem({ source_url: 'https://page2.com', title: 'Page 2' }),
      ]
      const props = createResultProps({ list, onPreview })

      render(<CrawledResult {...props} />)

      // Click preview on second item
      const previewButtons = screen.getAllByText('datasetCreation.stepOne.website.preview')
      await userEvent.click(previewButtons[1])

      expect(onPreview).toHaveBeenCalledWith(list[1])
    })

    it('should track preview index correctly', async () => {
      const onPreview = vi.fn()
      const list = [
        createCrawlResultItem({ source_url: 'https://page1.com', title: 'Page 1' }),
        createCrawlResultItem({ source_url: 'https://page2.com', title: 'Page 2' }),
      ]
      const props = createResultProps({ list, onPreview })

      render(<CrawledResult {...props} />)

      // Click preview on first item
      const previewButtons = screen.getAllByText('datasetCreation.stepOne.website.preview')
      await userEvent.click(previewButtons[0])

      expect(onPreview).toHaveBeenCalledWith(list[0])
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(CrawledResult.$$typeof).toBeDefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty list', () => {
      const props = createResultProps({ list: [], checkedList: [] })
      render(<CrawledResult {...props} />)

      // Should still render the header with resetAll (empty list = all checked)
      expect(screen.getByText('datasetCreation.stepOne.website.resetAll')).toBeInTheDocument()
    })

    it('should handle className prop', () => {
      const props = createResultProps({ className: 'custom-class' })
      const { container } = render(<CrawledResult {...props} />)

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })
})
