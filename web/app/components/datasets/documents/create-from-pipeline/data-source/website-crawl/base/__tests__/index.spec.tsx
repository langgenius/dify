import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import { RadioGroup } from '@langgenius/dify-ui/radio'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import CheckboxWithLabel from '../checkbox-with-label'
import CrawledResult from '../crawled-result'
import CrawledResultItem from '../crawled-result-item'
import Crawling from '../crawling'
import ErrorMessage from '../error-message'

const createMockCrawlResultItem = (
  overrides?: Partial<CrawlResultItemType>,
): CrawlResultItemType => ({
  source_url: 'https://example.com/page1',
  title: 'Test Page Title',
  markdown: '# Test content',
  description: 'Test description',
  ...overrides,
})

const createMockCrawlResultItems = (count = 3): CrawlResultItemType[] => {
  return Array.from({ length: count }, (_, i) =>
    createMockCrawlResultItem({
      source_url: `https://example.com/page${i + 1}`,
      title: `Page ${i + 1}`,
    }),
  )
}

// CheckboxWithLabel Tests
describe('CheckboxWithLabel', () => {
  const defaultProps = {
    isChecked: false,
    onChange: vi.fn(),
    label: 'Test Label',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render checkbox in unchecked state', () => {
      render(<CheckboxWithLabel {...defaultProps} isChecked={false} />)

      expect(screen.getByRole('checkbox', { name: 'Test Label' })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    })

    it('should render checkbox in checked state', () => {
      render(<CheckboxWithLabel {...defaultProps} isChecked={true} />)

      expect(screen.getByRole('checkbox', { name: 'Test Label' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })

    it('should render tooltip when provided', () => {
      render(<CheckboxWithLabel {...defaultProps} tooltip="Helpful tooltip text" />)

      expect(screen.getByLabelText('Helpful tooltip text'))!.toBeInTheDocument()
    })

    it('should not render tooltip when not provided', () => {
      render(<CheckboxWithLabel {...defaultProps} />)

      expect(screen.queryByLabelText('Helpful tooltip text')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with true when clicking unchecked checkbox', async () => {
      const mockOnChange = vi.fn()
      const user = userEvent.setup()
      render(<CheckboxWithLabel {...defaultProps} isChecked={false} onChange={mockOnChange} />)

      await user.click(screen.getByText('Test Label'))

      expect(mockOnChange).toHaveBeenCalledWith(true)
    })

    it('should call onChange with false when clicking checked checkbox', async () => {
      const mockOnChange = vi.fn()
      const user = userEvent.setup()
      render(<CheckboxWithLabel {...defaultProps} isChecked={true} onChange={mockOnChange} />)

      await user.click(screen.getByText('Test Label'))

      expect(mockOnChange).toHaveBeenCalledWith(false)
    })

    it('should trigger onChange when clicking label text', async () => {
      const mockOnChange = vi.fn()
      const user = userEvent.setup()
      render(<CheckboxWithLabel {...defaultProps} onChange={mockOnChange} />)

      await user.click(screen.getByText('Test Label'))

      expect(mockOnChange).toHaveBeenCalledWith(true)
    })
  })
})

// CrawledResultItem Tests
describe('CrawledResultItem', () => {
  const defaultProps = {
    payload: createMockCrawlResultItem(),
    isChecked: false,
    onCheckChange: vi.fn(),
    isPreview: false,
    showPreview: true,
    onPreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render checkbox when isMultipleChoice is true', () => {
      render(<CrawledResultItem {...defaultProps} isMultipleChoice={true} />)

      expect(screen.getByRole('checkbox', { name: /Test Page Title/ })).toBeInTheDocument()
    })

    it('should render radio when isMultipleChoice is false', () => {
      const { container } = render(<CrawledResultItem {...defaultProps} isMultipleChoice={false} />)

      // Assert - Radio component has size-4 rounded-full classes
      const radio = container.querySelector('.size-4.rounded-full')
      expect(radio)!.toBeInTheDocument()
    })

    it('should render checkbox as checked when isChecked is true', () => {
      render(<CrawledResultItem {...defaultProps} isChecked={true} />)

      expect(screen.getByRole('checkbox', { name: /Test Page Title/ })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })

    it('should render preview button when showPreview is true', () => {
      render(<CrawledResultItem {...defaultProps} showPreview={true} />)

      expect(screen.getByRole('button'))!.toBeInTheDocument()
    })

    it('should not render preview button when showPreview is false', () => {
      render(<CrawledResultItem {...defaultProps} showPreview={false} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should apply active background when isPreview is true', () => {
      const { container } = render(<CrawledResultItem {...defaultProps} isPreview={true} />)

      const item = container.firstChild
      expect(item)!.toHaveClass('bg-state-base-active')
    })
  })

  describe('Props', () => {
    it('should display payload title', () => {
      const payload = createMockCrawlResultItem({ title: 'Custom Title' })

      render(<CrawledResultItem {...defaultProps} payload={payload} />)

      expect(screen.getByText('Custom Title'))!.toBeInTheDocument()
    })

    it('should display payload source_url', () => {
      const payload = createMockCrawlResultItem({ source_url: 'https://custom.url/path' })

      render(<CrawledResultItem {...defaultProps} payload={payload} />)

      expect(screen.getByText('https://custom.url/path'))!.toBeInTheDocument()
    })

    it('should set title attribute for truncation tooltip', () => {
      const payload = createMockCrawlResultItem({ title: 'Very Long Title' })

      render(<CrawledResultItem {...defaultProps} payload={payload} />)

      const titleElement = screen.getByText('Very Long Title')
      expect(titleElement)!.toHaveAttribute('title', 'Very Long Title')
    })
  })

  describe('User Interactions', () => {
    it('should call onCheckChange with true when clicking unchecked checkbox', async () => {
      const mockOnCheckChange = vi.fn()
      const user = userEvent.setup()
      render(
        <CrawledResultItem {...defaultProps} isChecked={false} onCheckChange={mockOnCheckChange} />,
      )

      await user.click(screen.getByText('Test Page Title'))

      expect(mockOnCheckChange).toHaveBeenCalledWith(true)
    })

    it('should call onCheckChange with false when clicking checked checkbox', async () => {
      const mockOnCheckChange = vi.fn()
      const user = userEvent.setup()
      render(
        <CrawledResultItem {...defaultProps} isChecked={true} onCheckChange={mockOnCheckChange} />,
      )

      await user.click(screen.getByText('Test Page Title'))

      expect(mockOnCheckChange).toHaveBeenCalledWith(false)
    })

    it('should call onPreview when clicking preview button', () => {
      const mockOnPreview = vi.fn()
      render(<CrawledResultItem {...defaultProps} onPreview={mockOnPreview} />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockOnPreview).toHaveBeenCalled()
    })

    it('should toggle radio state when isMultipleChoice is false', () => {
      const mockOnCheckChange = vi.fn()
      render(
        <RadioGroup
          aria-label="Crawled pages"
          onValueChange={(sourceUrl) => {
            if (sourceUrl === defaultProps.payload.source_url) mockOnCheckChange(true)
          }}
        >
          <CrawledResultItem
            {...defaultProps}
            isMultipleChoice={false}
            isChecked={false}
            onCheckChange={mockOnCheckChange}
          />
        </RadioGroup>,
      )

      fireEvent.click(screen.getByRole('radio', { name: /Test Page Title/ }))

      expect(mockOnCheckChange).toHaveBeenCalledWith(true)
    })
  })
})

// CrawledResult Tests
describe('CrawledResult', () => {
  const defaultProps = {
    list: createMockCrawlResultItems(3),
    checkedList: [] as CrawlResultItemType[],
    onSelectedChange: vi.fn(),
    usedTime: 1.5,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render all list items', () => {
      render(<CrawledResult {...defaultProps} />)

      expect(screen.getByText('Page 1'))!.toBeInTheDocument()
      expect(screen.getByText('Page 2'))!.toBeInTheDocument()
      expect(screen.getByText('Page 3'))!.toBeInTheDocument()
    })

    it('should display scrape time info', () => {
      render(<CrawledResult {...defaultProps} usedTime={2.5} />)

      // Assert - Check for the time display
      // Assert - Check for the time display
      expect(screen.getByText(/2.5/))!.toBeInTheDocument()
    })

    it('should render select all checkbox when isMultipleChoice is true', () => {
      render(<CrawledResult {...defaultProps} isMultipleChoice={true} />)

      expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    })

    it('should not render select all checkbox when isMultipleChoice is false', () => {
      const { container } = render(<CrawledResult {...defaultProps} isMultipleChoice={false} />)

      // Assert - No select all checkbox, only radio buttons for items
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
      // Radio buttons have size-4 and rounded-full classes
      const radios = container.querySelectorAll('.size-4.rounded-full')
      expect(radios.length).toBe(3)
    })

    it('should show "Select All" when not all items are checked', () => {
      render(<CrawledResult {...defaultProps} checkedList={[]} />)

      expect(screen.getByText(/selectAll|Select All/i))!.toBeInTheDocument()
    })

    it('should show "Reset All" when all items are checked', () => {
      const allChecked = createMockCrawlResultItems(3)

      render(<CrawledResult {...defaultProps} checkedList={allChecked} />)

      expect(screen.getByText(/resetAll|Reset All/i))!.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should highlight item at previewIndex', () => {
      render(<CrawledResult {...defaultProps} previewIndex={1} />)

      // Assert - Second item should have active state
      expect(screen.getByText('Page 2').closest('.relative')).toHaveClass('bg-state-base-active')
    })

    it('should pass showPreview to items', () => {
      render(<CrawledResult {...defaultProps} showPreview={true} />)

      const buttons = screen.getAllByRole('button', {
        name: 'datasetCreation.stepOne.website.preview',
      })
      expect(buttons.length).toBe(3)
    })

    it('should not show preview buttons when showPreview is false', () => {
      render(<CrawledResult {...defaultProps} showPreview={false} />)

      expect(
        screen.queryByRole('button', { name: 'datasetCreation.stepOne.website.preview' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onSelectedChange with all items when clicking select all', async () => {
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const user = userEvent.setup()
      render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
        />,
      )

      await user.click(screen.getByText(/selectAll/i))

      expect(mockOnSelectedChange).toHaveBeenCalledWith(list)
    })

    it('should call onSelectedChange with empty array when clicking reset all', async () => {
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const user = userEvent.setup()
      render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={list}
          onSelectedChange={mockOnSelectedChange}
        />,
      )

      await user.click(screen.getByText(/resetAll/i))

      expect(mockOnSelectedChange).toHaveBeenCalledWith([])
    })

    it('should add item to checkedList when checking unchecked item', async () => {
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const user = userEvent.setup()
      render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={[list[0]!]}
          onSelectedChange={mockOnSelectedChange}
        />,
      )

      await user.click(screen.getByText('Page 2'))

      expect(mockOnSelectedChange).toHaveBeenCalledWith([list[0], list[1]])
    })

    it('should remove item from checkedList when unchecking checked item', async () => {
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const user = userEvent.setup()
      render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={[list[0]!, list[1]!]}
          onSelectedChange={mockOnSelectedChange}
        />,
      )

      await user.click(screen.getByText('Page 1'))

      expect(mockOnSelectedChange).toHaveBeenCalledWith([list[1]])
    })

    it('should replace selection when checking in single choice mode', () => {
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const { container } = render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={[list[0]!]}
          onSelectedChange={mockOnSelectedChange}
          isMultipleChoice={false}
        />,
      )

      // Act - Click second item radio (Radio uses size-4 rounded-full classes)
      const radios = container.querySelectorAll('.size-4.rounded-full')
      fireEvent.click(radios[1]!)

      // Assert - Should only select the clicked item
      expect(mockOnSelectedChange).toHaveBeenCalledWith([list[1]])
    })

    it('should call onPreview with item and index when clicking preview', () => {
      const mockOnPreview = vi.fn()
      const list = createMockCrawlResultItems(3)
      render(
        <CrawledResult
          {...defaultProps}
          list={list}
          onPreview={mockOnPreview}
          showPreview={true}
        />,
      )

      const buttons = screen.getAllByRole('button', {
        name: 'datasetCreation.stepOne.website.preview',
      })
      fireEvent.click(buttons[1]!) // Second item's preview button

      expect(mockOnPreview).toHaveBeenCalledWith(list[1], 1)
    })

    it('ignores preview clicks when the callback is omitted', () => {
      // Arrange - showPreview is true but onPreview is undefined
      const list = createMockCrawlResultItems(3)
      render(
        <CrawledResult {...defaultProps} list={list} onPreview={undefined} showPreview={true} />,
      )

      // Act - Click preview button should trigger early return in handlePreview
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0]!)

      // Assert - Should not throw error, component still renders
      // Assert - Should not throw error, component still renders
      expect(screen.getByText('Page 1'))!.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty list', () => {
      render(<CrawledResult {...defaultProps} list={[]} usedTime={0.5} />)

      // Assert - Should show time info with 0 count
      // Assert - Should show time info with 0 count
      expect(screen.getByText(/0.5/))!.toBeInTheDocument()
    })

    it('should handle single item list', () => {
      const singleItem = [createMockCrawlResultItem()]

      render(<CrawledResult {...defaultProps} list={singleItem} />)

      expect(screen.getByText('Test Page Title'))!.toBeInTheDocument()
    })

    it('should format usedTime to one decimal place', () => {
      render(<CrawledResult {...defaultProps} usedTime={1.567} />)

      expect(screen.getByText(/1.6/))!.toBeInTheDocument()
    })
  })
})

// Crawling Tests
describe('Crawling', () => {
  const defaultProps = {
    crawledNum: 5,
    totalNum: 10,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should display crawled count and total', () => {
      render(<Crawling crawledNum={3} totalNum={15} />)

      expect(screen.getByText(/3\/15/))!.toBeInTheDocument()
    })

    it('should render skeleton items', () => {
      const { container } = render(<Crawling {...defaultProps} />)

      // Assert - Should have 3 skeleton items
      const skeletonItems = container.querySelectorAll('.px-2.py-\\[5px\\]')
      expect(skeletonItems.length).toBe(3)
    })

    it('should render header skeleton block', () => {
      const { container } = render(<Crawling {...defaultProps} />)

      const headerBlocks = container.querySelectorAll('.px-4.py-2 .bg-text-quaternary')
      expect(headerBlocks.length).toBeGreaterThan(0)
    })
  })

  describe('Props', () => {
    it('should handle zero values', () => {
      render(<Crawling crawledNum={0} totalNum={0} />)

      expect(screen.getByText(/0\/0/))!.toBeInTheDocument()
    })

    it('should handle large numbers', () => {
      render(<Crawling crawledNum={999} totalNum={1000} />)

      expect(screen.getByText(/999\/1000/))!.toBeInTheDocument()
    })
  })

  describe('Skeleton Structure', () => {
    it('should render blocks with correct width classes', () => {
      const { container } = render(<Crawling {...defaultProps} />)

      // Assert - Check for various width classes
      // Assert - Check for various width classes
      expect(container.querySelector('.w-\\[35\\%\\]'))!.toBeInTheDocument()
      expect(container.querySelector('.w-\\[50\\%\\]'))!.toBeInTheDocument()
      expect(container.querySelector('.w-\\[40\\%\\]'))!.toBeInTheDocument()
    })
  })
})

// ErrorMessage Tests
describe('ErrorMessage', () => {
  const defaultProps = {
    title: 'Error Title',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render error icon', () => {
      const { container } = render(<ErrorMessage {...defaultProps} />)

      const icon = container.querySelector('svg')
      expect(icon)!.toBeInTheDocument()
      expect(icon)!.toHaveClass('text-text-destructive')
    })

    it('should render title', () => {
      render(<ErrorMessage title="Custom Error Title" />)

      expect(screen.getByText('Custom Error Title'))!.toBeInTheDocument()
    })

    it('should render error message when provided', () => {
      render(<ErrorMessage {...defaultProps} errorMsg="Detailed error description" />)

      expect(screen.getByText('Detailed error description'))!.toBeInTheDocument()
    })

    it('should not render error message when not provided', () => {
      render(<ErrorMessage {...defaultProps} />)

      // Assert - Should only have title, not error message container
      const textElements = screen.getAllByText(/Error Title/)
      expect(textElements.length).toBe(1)
    })
  })

  describe('Props', () => {
    it('should render with empty errorMsg', () => {
      render(<ErrorMessage {...defaultProps} errorMsg="" />)

      // Assert - Empty string should not render message div
      // Assert - Empty string should not render message div
      expect(screen.getByText('Error Title'))!.toBeInTheDocument()
    })

    it('should handle long title text', () => {
      const longTitle = 'This is a very long error title that might wrap to multiple lines'

      render(<ErrorMessage title={longTitle} />)

      expect(screen.getByText(longTitle))!.toBeInTheDocument()
    })

    it('should handle long error message', () => {
      const longErrorMsg =
        'This is a very detailed error message explaining what went wrong and how to fix it. It contains multiple sentences.'

      render(<ErrorMessage {...defaultProps} errorMsg={longErrorMsg} />)

      expect(screen.getByText(longErrorMsg))!.toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have rounded-sm corners', () => {
      const { container } = render(<ErrorMessage {...defaultProps} />)

      expect(container.firstChild)!.toHaveClass('rounded-xl')
    })
  })
})

describe('Base Components Integration', () => {
  it('should render CrawledResult with CrawledResultItem children', () => {
    const list = createMockCrawlResultItems(2)

    render(<CrawledResult list={list} checkedList={[]} onSelectedChange={vi.fn()} usedTime={1.0} />)

    // Assert - Both items should render
    // Assert - Both items should render
    expect(screen.getByText('Page 1'))!.toBeInTheDocument()
    expect(screen.getByText('Page 2'))!.toBeInTheDocument()
  })

  it('should render CrawledResult with CheckboxWithLabel for select all', () => {
    const list = createMockCrawlResultItems(2)

    render(
      <CrawledResult
        list={list}
        checkedList={[]}
        onSelectedChange={vi.fn()}
        usedTime={1.0}
        isMultipleChoice={true}
      />,
    )

    // Assert - Should have select all checkbox + item checkboxes
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('should allow selecting and previewing items', async () => {
    const list = createMockCrawlResultItems(3)
    const mockOnSelectedChange = vi.fn()
    const mockOnPreview = vi.fn()
    const user = userEvent.setup()

    render(
      <CrawledResult
        list={list}
        checkedList={[]}
        onSelectedChange={mockOnSelectedChange}
        onPreview={mockOnPreview}
        showPreview={true}
        usedTime={1.0}
      />,
    )

    await user.click(screen.getByText('Page 1'))

    expect(mockOnSelectedChange).toHaveBeenCalledWith([list[0]])

    // Act - Preview second item
    const previewButtons = screen.getAllByRole('button', {
      name: 'datasetCreation.stepOne.website.preview',
    })
    fireEvent.click(previewButtons[1]!)

    expect(mockOnPreview).toHaveBeenCalledWith(list[1], 1)
  })
})
