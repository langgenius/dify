import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'

import CrawledResult from '../crawled-result'

vi.mock('../checkbox-with-label', () => ({
  default: ({ isChecked, onChange, label }: { isChecked: boolean, onChange: () => void, label: string }) => (
    <label>
      <input
        type="checkbox"
        checked={isChecked}
        onChange={onChange}
        data-testid="check-all-checkbox"
      />
      {label}
    </label>
  ),
}))

vi.mock('../crawled-result-item', () => ({
  default: ({
    payload,
    isChecked,
    onCheckChange,
    onPreview,
  }: {
    payload: CrawlResultItem
    isChecked: boolean
    onCheckChange: (checked: boolean) => void
    onPreview: () => void
  }) => (
    <div data-testid={`crawled-item-${payload.source_url}`}>
      <span data-testid="item-url">{payload.source_url}</span>
      <button data-testid={`check-${payload.source_url}`} onClick={() => onCheckChange(!isChecked)}>
        {isChecked ? 'uncheck' : 'check'}
      </button>
      <button data-testid={`preview-${payload.source_url}`} onClick={onPreview}>
        preview
      </button>
    </div>
  ),
}))

const createItem = (url: string): CrawlResultItem => ({
  source_url: url,
  title: `Title for ${url}`,
  markdown: `# ${url}`,
  description: `Desc for ${url}`,
})

const defaultList: CrawlResultItem[] = [
  createItem('https://example.com/a'),
  createItem('https://example.com/b'),
  createItem('https://example.com/c'),
]

describe('CrawledResult', () => {
  const defaultProps = {
    list: defaultList,
    checkedList: [] as CrawlResultItem[],
    onSelectedChange: vi.fn(),
    usedTime: 12.345,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render scrap time info with correct total and time', () => {
      render(<CrawledResult {...defaultProps} />)

      expect(
        screen.getByText(/scrapTimeInfo/),
      ).toBeInTheDocument()
      // The global i18n mock serialises params, so verify total and time appear
      expect(screen.getByText(/"total":3/)).toBeInTheDocument()
      expect(screen.getByText(/"time":"12.3"/)).toBeInTheDocument()
    })

    it('should render all items from list', () => {
      render(<CrawledResult {...defaultProps} />)

      for (const item of defaultList) {
        expect(screen.getByTestId(`crawled-item-${item.source_url}`)).toBeInTheDocument()
      }
    })

    it('should apply custom className', () => {
      const { container } = render(
        <CrawledResult {...defaultProps} className="my-custom-class" />,
      )

      expect(container.firstChild).toHaveClass('my-custom-class')
    })
  })

  // Check-all checkbox visibility
  describe('Check All Checkbox', () => {
    it('should show check-all checkbox in multiple choice mode', () => {
      render(<CrawledResult {...defaultProps} isMultipleChoice={true} />)

      expect(screen.getByTestId('check-all-checkbox')).toBeInTheDocument()
    })

    it('should hide check-all checkbox in single choice mode', () => {
      render(<CrawledResult {...defaultProps} isMultipleChoice={false} />)

      expect(screen.queryByTestId('check-all-checkbox')).not.toBeInTheDocument()
    })
  })

  // Toggle all items
  describe('Toggle All', () => {
    it('should select all when not all checked', () => {
      const onSelectedChange = vi.fn()
      render(
        <CrawledResult
          {...defaultProps}
          checkedList={[defaultList[0]]}
          onSelectedChange={onSelectedChange}
        />,
      )

      fireEvent.click(screen.getByTestId('check-all-checkbox'))

      expect(onSelectedChange).toHaveBeenCalledWith(defaultList)
    })

    it('should deselect all when all checked', () => {
      const onSelectedChange = vi.fn()
      render(
        <CrawledResult
          {...defaultProps}
          checkedList={[...defaultList]}
          onSelectedChange={onSelectedChange}
        />,
      )

      fireEvent.click(screen.getByTestId('check-all-checkbox'))

      expect(onSelectedChange).toHaveBeenCalledWith([])
    })
  })

  // Individual item check
  describe('Individual Item Check', () => {
    it('should add item to selection in multiple choice mode', () => {
      const onSelectedChange = vi.fn()
      render(
        <CrawledResult
          {...defaultProps}
          checkedList={[defaultList[0]]}
          onSelectedChange={onSelectedChange}
          isMultipleChoice={true}
        />,
      )

      fireEvent.click(screen.getByTestId(`check-${defaultList[1].source_url}`))

      expect(onSelectedChange).toHaveBeenCalledWith([defaultList[0], defaultList[1]])
    })

    it('should replace selection in single choice mode', () => {
      const onSelectedChange = vi.fn()
      render(
        <CrawledResult
          {...defaultProps}
          checkedList={[defaultList[0]]}
          onSelectedChange={onSelectedChange}
          isMultipleChoice={false}
        />,
      )

      fireEvent.click(screen.getByTestId(`check-${defaultList[1].source_url}`))

      expect(onSelectedChange).toHaveBeenCalledWith([defaultList[1]])
    })

    it('should remove item from selection when unchecked', () => {
      const onSelectedChange = vi.fn()
      render(
        <CrawledResult
          {...defaultProps}
          checkedList={[defaultList[0], defaultList[1]]}
          onSelectedChange={onSelectedChange}
          isMultipleChoice={true}
        />,
      )

      fireEvent.click(screen.getByTestId(`check-${defaultList[0].source_url}`))

      expect(onSelectedChange).toHaveBeenCalledWith([defaultList[1]])
    })
  })

  // Preview
  describe('Preview', () => {
    it('should call onPreview with correct item and index', () => {
      const onPreview = vi.fn()
      render(
        <CrawledResult
          {...defaultProps}
          onPreview={onPreview}
          showPreview={true}
        />,
      )

      fireEvent.click(screen.getByTestId(`preview-${defaultList[1].source_url}`))

      expect(onPreview).toHaveBeenCalledWith(defaultList[1], 1)
    })
  })
})
