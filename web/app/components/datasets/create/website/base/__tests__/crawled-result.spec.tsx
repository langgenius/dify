import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CrawledResult from '../crawled-result'

const createMockItem = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page',
  markdown: '# Test',
  description: 'A test page',
  source_url: 'https://example.com',
  ...overrides,
})

const createMockList = (): CrawlResultItem[] => [
  createMockItem({ title: 'Page 1', source_url: 'https://example.com/1' }),
  createMockItem({ title: 'Page 2', source_url: 'https://example.com/2' }),
  createMockItem({ title: 'Page 3', source_url: 'https://example.com/3' }),
]

describe('CrawledResult', () => {
  const mockOnSelectedChange = vi.fn()
  const mockOnPreview = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render select all checkbox', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      expect(screen.getByRole('checkbox', { name: /selectAll/i })).toBeInTheDocument()
    })

    it('should render all items from list', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      expect(screen.getByText('Page 1')).toBeInTheDocument()
      expect(screen.getByText('Page 2')).toBeInTheDocument()
      expect(screen.getByText('Page 3')).toBeInTheDocument()
    })

    it('should render scrap time info', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      expect(screen.getByText(/scrapTimeInfo/i))!.toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const list = createMockList()
      const { container } = render(
        <CrawledResult
          className="custom-class"
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      const rootElement = container.firstChild as HTMLElement
      expect(rootElement)!.toHaveClass('custom-class')
    })
  })

  describe('Select All', () => {
    it('should call onSelectedChange with full list when not all checked', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={[list[0]!]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      const selectAllCheckbox = screen.getByRole('checkbox', { name: /selectAll/i })
      fireEvent.click(selectAllCheckbox)

      expect(mockOnSelectedChange).toHaveBeenCalledWith(list)
    })

    it('should call onSelectedChange with empty array when all checked', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={list}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      const selectAllCheckbox = screen.getByRole('checkbox', { name: /resetAll/i })
      fireEvent.click(selectAllCheckbox)

      expect(mockOnSelectedChange).toHaveBeenCalledWith([])
    })

    it('should show selectAll label when not all checked', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={[list[0]!]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      expect(screen.getByText(/selectAll/i))!.toBeInTheDocument()
    })

    it('should show resetAll label when all checked', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={list}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      expect(screen.getByText(/resetAll/i))!.toBeInTheDocument()
    })
  })

  describe('Individual Item Check', () => {
    it('should call onSelectedChange with added item when checking', () => {
      const list = createMockList()
      const checkedList = [list[0]!]
      render(
        <CrawledResult
          list={list}
          checkedList={checkedList}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      const item1Checkbox = screen.getByRole('checkbox', { name: /Page 2/ })
      fireEvent.click(item1Checkbox)

      expect(mockOnSelectedChange).toHaveBeenCalledWith([list[0], list[1]])
    })

    it('should call onSelectedChange with removed item when unchecking', () => {
      const list = createMockList()
      const checkedList = [list[0]!, list[1]!]
      render(
        <CrawledResult
          list={list}
          checkedList={checkedList}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      const item0Checkbox = screen.getByRole('checkbox', { name: /Page 1/ })
      fireEvent.click(item0Checkbox)

      expect(mockOnSelectedChange).toHaveBeenCalledWith([list[1]])
    })
  })

  describe('Preview', () => {
    it('should call onPreview with correct item when preview clicked', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      const previewButton = screen.getAllByRole('button', { name: /preview/i })[1]!
      fireEvent.click(previewButton)

      expect(mockOnPreview).toHaveBeenCalledWith(list[1])
    })

    it('should update preview state when preview button is clicked', () => {
      const list = createMockList()
      render(
        <CrawledResult
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={1.5}
        />,
      )

      const previewButton = screen.getAllByRole('button', { name: /preview/i })[0]!
      fireEvent.click(previewButton)

      const item0 = screen.getByText('Page 1').closest('.rounded-lg')
      expect(item0).toHaveClass('bg-state-base-active')
    })
  })

  describe('Edge Cases', () => {
    it('should render empty list without crashing', () => {
      render(
        <CrawledResult
          list={[]}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={0}
        />,
      )

      expect(screen.getByRole('checkbox', { name: /resetAll/i })).toBeInTheDocument()
    })

    it('should handle single item list', () => {
      const list = [createMockItem()]
      render(
        <CrawledResult
          list={list}
          checkedList={[]}
          onSelectedChange={mockOnSelectedChange}
          onPreview={mockOnPreview}
          usedTime={0.5}
        />,
      )

      expect(screen.getByText('Test Page')).toBeInTheDocument()
    })
  })
})
