import { fireEvent, render, screen } from '@testing-library/react'
import { Pagination } from './pagination'

// Helper to render Pagination with common defaults
function renderPagination({
  currentPage = 0,
  totalPages = 10,
  setCurrentPage = vi.fn(),
  edgePageCount = 2,
  middlePagesSiblingCount = 1,
  truncableText = '...',
  truncableClassName = 'truncable',
  children,
}: {
  currentPage?: number
  totalPages?: number
  setCurrentPage?: (page: number) => void
  edgePageCount?: number
  middlePagesSiblingCount?: number
  truncableText?: string
  truncableClassName?: string
  children?: React.ReactNode
} = {}) {
  return render(
    <Pagination
      currentPage={currentPage}
      totalPages={totalPages}
      setCurrentPage={setCurrentPage}
      edgePageCount={edgePageCount}
      middlePagesSiblingCount={middlePagesSiblingCount}
      truncableText={truncableText}
      truncableClassName={truncableClassName}
    >
      {children}
    </Pagination>,
  )
}

describe('Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = renderPagination()
      expect(container).toBeInTheDocument()
    })

    it('should render children', () => {
      renderPagination({ children: <span>child content</span> })
      expect(screen.getByText(/child content/i)).toBeInTheDocument()
    })

    it('should apply className to wrapper div', () => {
      const { container } = render(
        <Pagination
          currentPage={0}
          totalPages={5}
          setCurrentPage={vi.fn()}
          edgePageCount={2}
          middlePagesSiblingCount={1}
          className="my-pagination"
        >
          <span>test</span>
        </Pagination>,
      )
      expect(container.firstChild).toHaveClass('my-pagination')
    })

    it('should apply data-testid when provided', () => {
      render(
        <Pagination
          currentPage={0}
          totalPages={5}
          setCurrentPage={vi.fn()}
          edgePageCount={2}
          middlePagesSiblingCount={1}
          dataTestId="my-pagination"
        >
          <span>test</span>
        </Pagination>,
      )
      expect(screen.getByTestId('my-pagination')).toBeInTheDocument()
    })
  })

  describe('PrevButton', () => {
    it('should render prev button', () => {
      renderPagination({
        currentPage: 3,
        children: <Pagination.PrevButton>Prev</Pagination.PrevButton>,
      })
      expect(screen.getByText(/prev/i)).toBeInTheDocument()
    })

    it('should call setCurrentPage with previous page when clicked', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 3,
        setCurrentPage,
        children: <Pagination.PrevButton>Prev</Pagination.PrevButton>,
      })
      fireEvent.click(screen.getByText(/prev/i))
      expect(setCurrentPage).toHaveBeenCalledWith(2)
    })

    it('should not navigate below page 0', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 0,
        setCurrentPage,
        children: <Pagination.PrevButton>Prev</Pagination.PrevButton>,
      })
      fireEvent.click(screen.getByText(/prev/i))
      expect(setCurrentPage).not.toHaveBeenCalled()
    })

    it('should be disabled on first page', () => {
      renderPagination({
        currentPage: 0,
        children: <Pagination.PrevButton>Prev</Pagination.PrevButton>,
      })
      expect(screen.getByText(/prev/i).closest('button')).toBeDisabled()
    })

    it('should navigate on Enter key press', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 3,
        setCurrentPage,
        children: <Pagination.PrevButton>Prev</Pagination.PrevButton>,
      })
      fireEvent.keyPress(screen.getByText(/prev/i), { key: 'Enter', charCode: 13 })
      expect(setCurrentPage).toHaveBeenCalledWith(2)
    })

    it('should not navigate on Enter when disabled', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 0,
        setCurrentPage,
        children: <Pagination.PrevButton>Prev</Pagination.PrevButton>,
      })
      fireEvent.keyPress(screen.getByText(/prev/i), { key: 'Enter', charCode: 13 })
      expect(setCurrentPage).not.toHaveBeenCalled()
    })

    it('should render with custom as element', () => {
      renderPagination({
        currentPage: 3,
        children: <Pagination.PrevButton as={<div />}>Prev</Pagination.PrevButton>,
      })
      expect(screen.getByText(/prev/i)).toBeInTheDocument()
    })

    it('should apply dataTestId', () => {
      renderPagination({
        currentPage: 3,
        children: <Pagination.PrevButton dataTestId="prev-btn">Prev</Pagination.PrevButton>,
      })
      expect(screen.getByTestId('prev-btn')).toBeInTheDocument()
    })
  })

  describe('NextButton', () => {
    it('should render next button', () => {
      renderPagination({
        currentPage: 0,
        children: <Pagination.NextButton>Next</Pagination.NextButton>,
      })
      expect(screen.getByText(/next/i)).toBeInTheDocument()
    })

    it('should call setCurrentPage with next page when clicked', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 0,
        totalPages: 10,
        setCurrentPage,
        children: <Pagination.NextButton>Next</Pagination.NextButton>,
      })
      fireEvent.click(screen.getByText(/next/i))
      expect(setCurrentPage).toHaveBeenCalledWith(1)
    })

    it('should not navigate beyond last page', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 9,
        totalPages: 10,
        setCurrentPage,
        children: <Pagination.NextButton>Next</Pagination.NextButton>,
      })
      fireEvent.click(screen.getByText(/next/i))
      expect(setCurrentPage).not.toHaveBeenCalled()
    })

    it('should be disabled on last page', () => {
      renderPagination({
        currentPage: 9,
        totalPages: 10,
        children: <Pagination.NextButton>Next</Pagination.NextButton>,
      })
      expect(screen.getByText(/next/i).closest('button')).toBeDisabled()
    })

    it('should navigate on Enter key press', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 0,
        totalPages: 10,
        setCurrentPage,
        children: <Pagination.NextButton>Next</Pagination.NextButton>,
      })
      fireEvent.keyPress(screen.getByText(/next/i), { key: 'Enter', charCode: 13 })
      expect(setCurrentPage).toHaveBeenCalledWith(1)
    })

    it('should not navigate on Enter when disabled', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 9,
        totalPages: 10,
        setCurrentPage,
        children: <Pagination.NextButton>Next</Pagination.NextButton>,
      })
      fireEvent.keyPress(screen.getByText(/next/i), { key: 'Enter', charCode: 13 })
      expect(setCurrentPage).not.toHaveBeenCalled()
    })

    it('should apply dataTestId', () => {
      renderPagination({
        currentPage: 0,
        children: <Pagination.NextButton dataTestId="next-btn">Next</Pagination.NextButton>,
      })
      expect(screen.getByTestId('next-btn')).toBeInTheDocument()
    })
  })

  describe('PageButton', () => {
    it('should render page number buttons', () => {
      renderPagination({
        currentPage: 0,
        totalPages: 5,
        children: (
          <Pagination.PageButton
            className="page-btn"
            activeClassName="active"
            inactiveClassName="inactive"
          />
        ),
      })
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('should apply activeClassName to current page', () => {
      renderPagination({
        currentPage: 2,
        totalPages: 5,
        children: (
          <Pagination.PageButton
            className="page-btn"
            activeClassName="active"
            inactiveClassName="inactive"
          />
        ),
      })
      // current page is 2, so page 3 (1-indexed) should be active
      expect(screen.getByText('3').closest('a')).toHaveClass('active')
    })

    it('should apply inactiveClassName to non-current pages', () => {
      renderPagination({
        currentPage: 2,
        totalPages: 5,
        children: (
          <Pagination.PageButton
            className="page-btn"
            activeClassName="active"
            inactiveClassName="inactive"
          />
        ),
      })
      expect(screen.getByText('1').closest('a')).toHaveClass('inactive')
    })

    it('should call setCurrentPage when a page button is clicked', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 0,
        totalPages: 5,
        setCurrentPage,
        children: (
          <Pagination.PageButton
            className="page-btn"
            activeClassName="active"
            inactiveClassName="inactive"
          />
        ),
      })
      fireEvent.click(screen.getByText('3'))
      expect(setCurrentPage).toHaveBeenCalledWith(2) // 0-indexed
    })

    it('should navigate on Enter key press on a page button', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 0,
        totalPages: 5,
        setCurrentPage,
        children: (
          <Pagination.PageButton
            className="page-btn"
            activeClassName="active"
            inactiveClassName="inactive"
          />
        ),
      })
      fireEvent.keyPress(screen.getByText('4'), { key: 'Enter', charCode: 13 })
      expect(setCurrentPage).toHaveBeenCalledWith(3) // 0-indexed
    })

    it('should render truncable text when pages are truncated', () => {
      renderPagination({
        currentPage: 5,
        totalPages: 20,
        edgePageCount: 2,
        middlePagesSiblingCount: 1,
        truncableText: '...',
        children: (
          <Pagination.PageButton
            className="page-btn"
            activeClassName="active"
            inactiveClassName="inactive"
          />
        ),
      })
      // With 20 pages and current at 5, there should be truncation
      expect(screen.getAllByText('...').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle single page', () => {
      const setCurrentPage = vi.fn()
      renderPagination({
        currentPage: 0,
        totalPages: 1,
        setCurrentPage,
        children: (
          <>
            <Pagination.PrevButton>Prev</Pagination.PrevButton>
            <Pagination.PageButton className="page-btn" activeClassName="active" inactiveClassName="inactive" />
            <Pagination.NextButton>Next</Pagination.NextButton>
          </>
        ),
      })
      expect(screen.getByText(/prev/i).closest('button')).toBeDisabled()
      expect(screen.getByText(/next/i).closest('button')).toBeDisabled()
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('should handle zero total pages', () => {
      const { container } = renderPagination({
        currentPage: 0,
        totalPages: 0,
        children: (
          <Pagination.PageButton className="page-btn" activeClassName="active" inactiveClassName="inactive" />
        ),
      })
      expect(container).toBeInTheDocument()
    })
  })
})
