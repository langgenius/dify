import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import CheckboxWithLabel from './checkbox-with-label'
import CrawledResult from './crawled-result'
import CrawledResultItem from './crawled-result-item'
import Crawling from './crawling'
import ErrorMessage from './error-message'

// ==========================================
// Test Data Builders
// ==========================================

const createMockCrawlResultItem = (overrides?: Partial<CrawlResultItemType>): CrawlResultItemType => ({
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
    }))
}

// ==========================================
// CheckboxWithLabel Tests
// ==========================================
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
    it('should render without crashing', () => {
      // Arrange & Act
      render(<CheckboxWithLabel {...defaultProps} />)

      // Assert
      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should render checkbox in unchecked state', () => {
      // Arrange & Act
      const { container } = render(<CheckboxWithLabel {...defaultProps} isChecked={false} />)

      // Assert - Custom checkbox component uses div with data-testid
      const checkbox = container.querySelector('[data-testid^="checkbox"]')
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).not.toHaveClass('bg-components-checkbox-bg')
    })

    it('should render checkbox in checked state', () => {
      // Arrange & Act
      const { container } = render(<CheckboxWithLabel {...defaultProps} isChecked={true} />)

      // Assert - Checked state has check icon
      const checkIcon = container.querySelector('[data-testid^="check-icon"]')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should render tooltip when provided', () => {
      // Arrange & Act
      render(<CheckboxWithLabel {...defaultProps} tooltip="Helpful tooltip text" />)

      // Assert - Tooltip trigger should be present
      const tooltipTrigger = document.querySelector('[class*="ml-0.5"]')
      expect(tooltipTrigger).toBeInTheDocument()
    })

    it('should not render tooltip when not provided', () => {
      // Arrange & Act
      render(<CheckboxWithLabel {...defaultProps} />)

      // Assert
      const tooltipTrigger = document.querySelector('[class*="ml-0.5"]')
      expect(tooltipTrigger).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <CheckboxWithLabel {...defaultProps} className="custom-class" />,
      )

      // Assert
      const label = container.querySelector('label')
      expect(label).toHaveClass('custom-class')
    })

    it('should apply custom labelClassName', () => {
      // Arrange & Act
      render(<CheckboxWithLabel {...defaultProps} labelClassName="custom-label-class" />)

      // Assert
      const labelText = screen.getByText('Test Label')
      expect(labelText).toHaveClass('custom-label-class')
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with true when clicking unchecked checkbox', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const { container } = render(<CheckboxWithLabel {...defaultProps} isChecked={false} onChange={mockOnChange} />)

      // Act
      const checkbox = container.querySelector('[data-testid^="checkbox"]')!
      fireEvent.click(checkbox)

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(true)
    })

    it('should call onChange with false when clicking checked checkbox', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const { container } = render(<CheckboxWithLabel {...defaultProps} isChecked={true} onChange={mockOnChange} />)

      // Act
      const checkbox = container.querySelector('[data-testid^="checkbox"]')!
      fireEvent.click(checkbox)

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(false)
    })

    it('should not trigger onChange when clicking label text due to custom checkbox', () => {
      // Arrange
      const mockOnChange = vi.fn()
      render(<CheckboxWithLabel {...defaultProps} onChange={mockOnChange} />)

      // Act - Click on the label text element
      const labelText = screen.getByText('Test Label')
      fireEvent.click(labelText)

      // Assert - Custom checkbox does not support native label-input click forwarding
      expect(mockOnChange).not.toHaveBeenCalled()
    })
  })
})

// ==========================================
// CrawledResultItem Tests
// ==========================================
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
    it('should render without crashing', () => {
      // Arrange & Act
      render(<CrawledResultItem {...defaultProps} />)

      // Assert
      expect(screen.getByText('Test Page Title')).toBeInTheDocument()
      expect(screen.getByText('https://example.com/page1')).toBeInTheDocument()
    })

    it('should render checkbox when isMultipleChoice is true', () => {
      // Arrange & Act
      const { container } = render(<CrawledResultItem {...defaultProps} isMultipleChoice={true} />)

      // Assert - Custom checkbox uses data-testid
      const checkbox = container.querySelector('[data-testid^="checkbox"]')
      expect(checkbox).toBeInTheDocument()
    })

    it('should render radio when isMultipleChoice is false', () => {
      // Arrange & Act
      const { container } = render(<CrawledResultItem {...defaultProps} isMultipleChoice={false} />)

      // Assert - Radio component has size-4 rounded-full classes
      const radio = container.querySelector('.size-4.rounded-full')
      expect(radio).toBeInTheDocument()
    })

    it('should render checkbox as checked when isChecked is true', () => {
      // Arrange & Act
      const { container } = render(<CrawledResultItem {...defaultProps} isChecked={true} />)

      // Assert - Checked state shows check icon
      const checkIcon = container.querySelector('[data-testid^="check-icon"]')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should render preview button when showPreview is true', () => {
      // Arrange & Act
      render(<CrawledResultItem {...defaultProps} showPreview={true} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should not render preview button when showPreview is false', () => {
      // Arrange & Act
      render(<CrawledResultItem {...defaultProps} showPreview={false} />)

      // Assert
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should apply active background when isPreview is true', () => {
      // Arrange & Act
      const { container } = render(<CrawledResultItem {...defaultProps} isPreview={true} />)

      // Assert
      const item = container.firstChild
      expect(item).toHaveClass('bg-state-base-active')
    })

    it('should apply hover styles when isPreview is false', () => {
      // Arrange & Act
      const { container } = render(<CrawledResultItem {...defaultProps} isPreview={false} />)

      // Assert
      const item = container.firstChild
      expect(item).toHaveClass('group')
      expect(item).toHaveClass('hover:bg-state-base-hover')
    })
  })

  describe('Props', () => {
    it('should display payload title', () => {
      // Arrange
      const payload = createMockCrawlResultItem({ title: 'Custom Title' })

      // Act
      render(<CrawledResultItem {...defaultProps} payload={payload} />)

      // Assert
      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })

    it('should display payload source_url', () => {
      // Arrange
      const payload = createMockCrawlResultItem({ source_url: 'https://custom.url/path' })

      // Act
      render(<CrawledResultItem {...defaultProps} payload={payload} />)

      // Assert
      expect(screen.getByText('https://custom.url/path')).toBeInTheDocument()
    })

    it('should set title attribute for truncation tooltip', () => {
      // Arrange
      const payload = createMockCrawlResultItem({ title: 'Very Long Title' })

      // Act
      render(<CrawledResultItem {...defaultProps} payload={payload} />)

      // Assert
      const titleElement = screen.getByText('Very Long Title')
      expect(titleElement).toHaveAttribute('title', 'Very Long Title')
    })
  })

  describe('User Interactions', () => {
    it('should call onCheckChange with true when clicking unchecked checkbox', () => {
      // Arrange
      const mockOnCheckChange = vi.fn()
      const { container } = render(
        <CrawledResultItem
          {...defaultProps}
          isChecked={false}
          onCheckChange={mockOnCheckChange}
        />,
      )

      // Act
      const checkbox = container.querySelector('[data-testid^="checkbox"]')!
      fireEvent.click(checkbox)

      // Assert
      expect(mockOnCheckChange).toHaveBeenCalledWith(true)
    })

    it('should call onCheckChange with false when clicking checked checkbox', () => {
      // Arrange
      const mockOnCheckChange = vi.fn()
      const { container } = render(
        <CrawledResultItem
          {...defaultProps}
          isChecked={true}
          onCheckChange={mockOnCheckChange}
        />,
      )

      // Act
      const checkbox = container.querySelector('[data-testid^="checkbox"]')!
      fireEvent.click(checkbox)

      // Assert
      expect(mockOnCheckChange).toHaveBeenCalledWith(false)
    })

    it('should call onPreview when clicking preview button', () => {
      // Arrange
      const mockOnPreview = vi.fn()
      render(<CrawledResultItem {...defaultProps} onPreview={mockOnPreview} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnPreview).toHaveBeenCalled()
    })

    it('should toggle radio state when isMultipleChoice is false', () => {
      // Arrange
      const mockOnCheckChange = vi.fn()
      const { container } = render(
        <CrawledResultItem
          {...defaultProps}
          isMultipleChoice={false}
          isChecked={false}
          onCheckChange={mockOnCheckChange}
        />,
      )

      // Act - Radio uses size-4 rounded-full classes
      const radio = container.querySelector('.size-4.rounded-full')!
      fireEvent.click(radio)

      // Assert
      expect(mockOnCheckChange).toHaveBeenCalledWith(true)
    })
  })
})

// ==========================================
// CrawledResult Tests
// ==========================================
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
    it('should render without crashing', () => {
      // Arrange & Act
      render(<CrawledResult {...defaultProps} />)

      // Assert - Check for time info which contains total count
      expect(screen.getByText(/1.5/)).toBeInTheDocument()
    })

    it('should render all list items', () => {
      // Arrange & Act
      render(<CrawledResult {...defaultProps} />)

      // Assert
      expect(screen.getByText('Page 1')).toBeInTheDocument()
      expect(screen.getByText('Page 2')).toBeInTheDocument()
      expect(screen.getByText('Page 3')).toBeInTheDocument()
    })

    it('should display scrape time info', () => {
      // Arrange & Act
      render(<CrawledResult {...defaultProps} usedTime={2.5} />)

      // Assert - Check for the time display
      expect(screen.getByText(/2.5/)).toBeInTheDocument()
    })

    it('should render select all checkbox when isMultipleChoice is true', () => {
      // Arrange & Act
      const { container } = render(<CrawledResult {...defaultProps} isMultipleChoice={true} />)

      // Assert - Multiple custom checkboxes (select all + items)
      const checkboxes = container.querySelectorAll('[data-testid^="checkbox"]')
      expect(checkboxes.length).toBe(4) // 1 select all + 3 items
    })

    it('should not render select all checkbox when isMultipleChoice is false', () => {
      // Arrange & Act
      const { container } = render(<CrawledResult {...defaultProps} isMultipleChoice={false} />)

      // Assert - No select all checkbox, only radio buttons for items
      const checkboxes = container.querySelectorAll('[data-testid^="checkbox"]')
      expect(checkboxes.length).toBe(0)
      // Radio buttons have size-4 and rounded-full classes
      const radios = container.querySelectorAll('.size-4.rounded-full')
      expect(radios.length).toBe(3)
    })

    it('should show "Select All" when not all items are checked', () => {
      // Arrange & Act
      render(<CrawledResult {...defaultProps} checkedList={[]} />)

      // Assert
      expect(screen.getByText(/selectAll|Select All/i)).toBeInTheDocument()
    })

    it('should show "Reset All" when all items are checked', () => {
      // Arrange
      const allChecked = createMockCrawlResultItems(3)

      // Act
      render(<CrawledResult {...defaultProps} checkedList={allChecked} />)

      // Assert
      expect(screen.getByText(/resetAll|Reset All/i)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <CrawledResult {...defaultProps} className="custom-class" />,
      )

      // Assert
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should highlight item at previewIndex', () => {
      // Arrange & Act
      const { container } = render(
        <CrawledResult {...defaultProps} previewIndex={1} />,
      )

      // Assert - Second item should have active state
      const items = container.querySelectorAll('[class*="rounded-lg"][class*="cursor-pointer"]')
      expect(items[1]).toHaveClass('bg-state-base-active')
    })

    it('should pass showPreview to items', () => {
      // Arrange & Act
      render(<CrawledResult {...defaultProps} showPreview={true} />)

      // Assert - Preview buttons should be visible
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(3)
    })

    it('should not show preview buttons when showPreview is false', () => {
      // Arrange & Act
      render(<CrawledResult {...defaultProps} showPreview={false} />)

      // Assert
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onSelectedChange with all items when clicking select all', () => {
      // Arrange
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const { container } = render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
        />,
      )

      // Act - Click select all checkbox (first checkbox)
      const checkboxes = container.querySelectorAll('[data-testid^="checkbox"]')
      fireEvent.click(checkboxes[0])

      // Assert
      expect(mockOnSelectedChange).toHaveBeenCalledWith(list)
    })

    it('should call onSelectedChange with empty array when clicking reset all', () => {
      // Arrange
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const { container } = render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={list}
          onSelectedChange={mockOnSelectedChange}
        />,
      )

      // Act
      const checkboxes = container.querySelectorAll('[data-testid^="checkbox"]')
      fireEvent.click(checkboxes[0])

      // Assert
      expect(mockOnSelectedChange).toHaveBeenCalledWith([])
    })

    it('should add item to checkedList when checking unchecked item', () => {
      // Arrange
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const { container } = render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={[list[0]]}
          onSelectedChange={mockOnSelectedChange}
        />,
      )

      // Act - Click second item checkbox (index 2, accounting for select all)
      const checkboxes = container.querySelectorAll('[data-testid^="checkbox"]')
      fireEvent.click(checkboxes[2])

      // Assert
      expect(mockOnSelectedChange).toHaveBeenCalledWith([list[0], list[1]])
    })

    it('should remove item from checkedList when unchecking checked item', () => {
      // Arrange
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const { container } = render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={[list[0], list[1]]}
          onSelectedChange={mockOnSelectedChange}
        />,
      )

      // Act - Uncheck first item (index 1, after select all)
      const checkboxes = container.querySelectorAll('[data-testid^="checkbox"]')
      fireEvent.click(checkboxes[1])

      // Assert
      expect(mockOnSelectedChange).toHaveBeenCalledWith([list[1]])
    })

    it('should replace selection when checking in single choice mode', () => {
      // Arrange
      const mockOnSelectedChange = vi.fn()
      const list = createMockCrawlResultItems(3)
      const { container } = render(
        <CrawledResult
          {...defaultProps}
          list={list}
          checkedList={[list[0]]}
          onSelectedChange={mockOnSelectedChange}
          isMultipleChoice={false}
        />,
      )

      // Act - Click second item radio (Radio uses size-4 rounded-full classes)
      const radios = container.querySelectorAll('.size-4.rounded-full')
      fireEvent.click(radios[1])

      // Assert - Should only select the clicked item
      expect(mockOnSelectedChange).toHaveBeenCalledWith([list[1]])
    })

    it('should call onPreview with item and index when clicking preview', () => {
      // Arrange
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

      // Act
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1]) // Second item's preview button

      // Assert
      expect(mockOnPreview).toHaveBeenCalledWith(list[1], 1)
    })

    it('should not crash when clicking preview without onPreview callback', () => {
      // Arrange - showPreview is true but onPreview is undefined
      const list = createMockCrawlResultItems(3)
      render(
        <CrawledResult
          {...defaultProps}
          list={list}
          onPreview={undefined}
          showPreview={true}
        />,
      )

      // Act - Click preview button should trigger early return in handlePreview
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      // Assert - Should not throw error, component still renders
      expect(screen.getByText('Page 1')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty list', () => {
      // Arrange & Act
      render(<CrawledResult {...defaultProps} list={[]} usedTime={0.5} />)

      // Assert - Should show time info with 0 count
      expect(screen.getByText(/0.5/)).toBeInTheDocument()
    })

    it('should handle single item list', () => {
      // Arrange
      const singleItem = [createMockCrawlResultItem()]

      // Act
      render(<CrawledResult {...defaultProps} list={singleItem} />)

      // Assert
      expect(screen.getByText('Test Page Title')).toBeInTheDocument()
    })

    it('should format usedTime to one decimal place', () => {
      // Arrange & Act
      render(<CrawledResult {...defaultProps} usedTime={1.567} />)

      // Assert
      expect(screen.getByText(/1.6/)).toBeInTheDocument()
    })
  })
})

// ==========================================
// Crawling Tests
// ==========================================
describe('Crawling', () => {
  const defaultProps = {
    crawledNum: 5,
    totalNum: 10,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<Crawling {...defaultProps} />)

      // Assert
      expect(screen.getByText(/5\/10/)).toBeInTheDocument()
    })

    it('should display crawled count and total', () => {
      // Arrange & Act
      render(<Crawling crawledNum={3} totalNum={15} />)

      // Assert
      expect(screen.getByText(/3\/15/)).toBeInTheDocument()
    })

    it('should render skeleton items', () => {
      // Arrange & Act
      const { container } = render(<Crawling {...defaultProps} />)

      // Assert - Should have 3 skeleton items
      const skeletonItems = container.querySelectorAll('.px-2.py-\\[5px\\]')
      expect(skeletonItems.length).toBe(3)
    })

    it('should render header skeleton block', () => {
      // Arrange & Act
      const { container } = render(<Crawling {...defaultProps} />)

      // Assert
      const headerBlocks = container.querySelectorAll('.px-4.py-2 .bg-text-quaternary')
      expect(headerBlocks.length).toBeGreaterThan(0)
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <Crawling {...defaultProps} className="custom-crawling-class" />,
      )

      // Assert
      expect(container.firstChild).toHaveClass('custom-crawling-class')
    })

    it('should handle zero values', () => {
      // Arrange & Act
      render(<Crawling crawledNum={0} totalNum={0} />)

      // Assert
      expect(screen.getByText(/0\/0/)).toBeInTheDocument()
    })

    it('should handle large numbers', () => {
      // Arrange & Act
      render(<Crawling crawledNum={999} totalNum={1000} />)

      // Assert
      expect(screen.getByText(/999\/1000/)).toBeInTheDocument()
    })
  })

  describe('Skeleton Structure', () => {
    it('should render blocks with correct width classes', () => {
      // Arrange & Act
      const { container } = render(<Crawling {...defaultProps} />)

      // Assert - Check for various width classes
      expect(container.querySelector('.w-\\[35\\%\\]')).toBeInTheDocument()
      expect(container.querySelector('.w-\\[50\\%\\]')).toBeInTheDocument()
      expect(container.querySelector('.w-\\[40\\%\\]')).toBeInTheDocument()
    })
  })
})

// ==========================================
// ErrorMessage Tests
// ==========================================
describe('ErrorMessage', () => {
  const defaultProps = {
    title: 'Error Title',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<ErrorMessage {...defaultProps} />)

      // Assert
      expect(screen.getByText('Error Title')).toBeInTheDocument()
    })

    it('should render error icon', () => {
      // Arrange & Act
      const { container } = render(<ErrorMessage {...defaultProps} />)

      // Assert
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
      expect(icon).toHaveClass('text-text-destructive')
    })

    it('should render title', () => {
      // Arrange & Act
      render(<ErrorMessage title="Custom Error Title" />)

      // Assert
      expect(screen.getByText('Custom Error Title')).toBeInTheDocument()
    })

    it('should render error message when provided', () => {
      // Arrange & Act
      render(<ErrorMessage {...defaultProps} errorMsg="Detailed error description" />)

      // Assert
      expect(screen.getByText('Detailed error description')).toBeInTheDocument()
    })

    it('should not render error message when not provided', () => {
      // Arrange & Act
      render(<ErrorMessage {...defaultProps} />)

      // Assert - Should only have title, not error message container
      const textElements = screen.getAllByText(/Error Title/)
      expect(textElements.length).toBe(1)
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <ErrorMessage {...defaultProps} className="custom-error-class" />,
      )

      // Assert
      expect(container.firstChild).toHaveClass('custom-error-class')
    })

    it('should render with empty errorMsg', () => {
      // Arrange & Act
      render(<ErrorMessage {...defaultProps} errorMsg="" />)

      // Assert - Empty string should not render message div
      expect(screen.getByText('Error Title')).toBeInTheDocument()
    })

    it('should handle long title text', () => {
      // Arrange
      const longTitle = 'This is a very long error title that might wrap to multiple lines'

      // Act
      render(<ErrorMessage title={longTitle} />)

      // Assert
      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should handle long error message', () => {
      // Arrange
      const longErrorMsg = 'This is a very detailed error message explaining what went wrong and how to fix it. It contains multiple sentences.'

      // Act
      render(<ErrorMessage {...defaultProps} errorMsg={longErrorMsg} />)

      // Assert
      expect(screen.getByText(longErrorMsg)).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have error background styling', () => {
      // Arrange & Act
      const { container } = render(<ErrorMessage {...defaultProps} />)

      // Assert
      expect(container.firstChild).toHaveClass('bg-toast-error-bg')
    })

    it('should have border styling', () => {
      // Arrange & Act
      const { container } = render(<ErrorMessage {...defaultProps} />)

      // Assert
      expect(container.firstChild).toHaveClass('border-components-panel-border')
    })

    it('should have rounded corners', () => {
      // Arrange & Act
      const { container } = render(<ErrorMessage {...defaultProps} />)

      // Assert
      expect(container.firstChild).toHaveClass('rounded-xl')
    })
  })
})

// ==========================================
// Integration Tests
// ==========================================
describe('Base Components Integration', () => {
  it('should render CrawledResult with CrawledResultItem children', () => {
    // Arrange
    const list = createMockCrawlResultItems(2)

    // Act
    render(
      <CrawledResult
        list={list}
        checkedList={[]}
        onSelectedChange={vi.fn()}
        usedTime={1.0}
      />,
    )

    // Assert - Both items should render
    expect(screen.getByText('Page 1')).toBeInTheDocument()
    expect(screen.getByText('Page 2')).toBeInTheDocument()
  })

  it('should render CrawledResult with CheckboxWithLabel for select all', () => {
    // Arrange
    const list = createMockCrawlResultItems(2)

    // Act
    const { container } = render(
      <CrawledResult
        list={list}
        checkedList={[]}
        onSelectedChange={vi.fn()}
        usedTime={1.0}
        isMultipleChoice={true}
      />,
    )

    // Assert - Should have select all checkbox + item checkboxes
    const checkboxes = container.querySelectorAll('[data-testid^="checkbox"]')
    expect(checkboxes.length).toBe(3) // select all + 2 items
  })

  it('should allow selecting and previewing items', () => {
    // Arrange
    const list = createMockCrawlResultItems(3)
    const mockOnSelectedChange = vi.fn()
    const mockOnPreview = vi.fn()

    const { container } = render(
      <CrawledResult
        list={list}
        checkedList={[]}
        onSelectedChange={mockOnSelectedChange}
        onPreview={mockOnPreview}
        showPreview={true}
        usedTime={1.0}
      />,
    )

    // Act - Select first item (index 1, after select all)
    const checkboxes = container.querySelectorAll('[data-testid^="checkbox"]')
    fireEvent.click(checkboxes[1])

    // Assert
    expect(mockOnSelectedChange).toHaveBeenCalledWith([list[0]])

    // Act - Preview second item
    const previewButtons = screen.getAllByRole('button')
    fireEvent.click(previewButtons[1])

    // Assert
    expect(mockOnPreview).toHaveBeenCalledWith(list[1], 1)
  })
})
