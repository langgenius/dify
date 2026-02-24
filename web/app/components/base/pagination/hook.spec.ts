import { renderHook } from '@testing-library/react'
import usePagination from './hook'

const defaultProps = {
  currentPage: 0,
  setCurrentPage: vi.fn(),
  totalPages: 10,
  edgePageCount: 2,
  middlePagesSiblingCount: 1,
  truncableText: '...',
  truncableClassName: 'truncable',
}

describe('usePagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('pages', () => {
    it('should generate correct pages array', () => {
      const { result } = renderHook(() => usePagination(defaultProps))
      expect(result.current.pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })

    it('should generate empty pages for totalPages 0', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, totalPages: 0 }))
      expect(result.current.pages).toEqual([])
    })

    it('should generate single page', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, totalPages: 1 }))
      expect(result.current.pages).toEqual([1])
    })
  })

  describe('hasPreviousPage / hasNextPage', () => {
    it('should have no previous page on first page', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 1 }))
      expect(result.current.hasPreviousPage).toBe(false)
    })

    it('should have previous page when not on first page', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 3 }))
      expect(result.current.hasPreviousPage).toBe(true)
    })

    it('should have next page when not on last page', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 1 }))
      expect(result.current.hasNextPage).toBe(true)
    })

    it('should have no next page on last page', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 10 }))
      expect(result.current.hasNextPage).toBe(false)
    })
  })

  describe('middlePages', () => {
    it('should return correct middle pages when at start', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 0 }))
      // isReachedToFirst: currentPage(0) <= middlePagesSiblingCount(1), so slice(0, 3)
      expect(result.current.middlePages).toEqual([1, 2, 3])
    })

    it('should return correct middle pages when in the middle', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 5 }))
      // Not at start or end, slice(5-1, 5+1+1) = slice(4, 7) = [5, 6, 7]
      expect(result.current.middlePages).toEqual([5, 6, 7])
    })

    it('should return correct middle pages when at end', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 9 }))
      // isReachedToLast: currentPage(9) + middlePagesSiblingCount(1) >= totalPages(10), so slice(-3)
      expect(result.current.middlePages).toEqual([8, 9, 10])
    })
  })

  describe('previousPages and nextPages', () => {
    it('should return empty previousPages when at start', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 0 }))
      expect(result.current.previousPages).toEqual([])
    })

    it('should return previousPages when in the middle', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 5 }))
      // edgePageCount=2, so first 2 pages filtered by not in middlePages
      expect(result.current.previousPages).toEqual([1, 2])
    })

    it('should return empty nextPages when at end', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 9 }))
      expect(result.current.nextPages).toEqual([])
    })

    it('should return nextPages when in the middle', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 5 }))
      // Last 2 pages: [9, 10], filtered by not in middlePages [5,6,7]
      expect(result.current.nextPages).toEqual([9, 10])
    })
  })

  describe('truncation', () => {
    it('should be previous truncable when middle pages are far from edge', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 5 }))
      // previousPages=[1,2], middlePages=[5,6,7], 5 > 2+1 = true
      expect(result.current.isPreviousTruncable).toBe(true)
    })

    it('should not be previous truncable when pages are contiguous', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 2 }))
      expect(result.current.isPreviousTruncable).toBe(false)
    })

    it('should be next truncable when middle pages are far from end edge', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 5 }))
      // middlePages=[5,6,7], nextPages=[9,10], 7+1 < 9 = true
      expect(result.current.isNextTruncable).toBe(true)
    })

    it('should not be next truncable when pages are contiguous', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 7 }))
      expect(result.current.isNextTruncable).toBe(false)
    })
  })

  describe('passthrough values', () => {
    it('should pass through currentPage', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, currentPage: 5 }))
      expect(result.current.currentPage).toBe(5)
    })

    it('should pass through setCurrentPage', () => {
      const setCurrentPage = vi.fn()
      const { result } = renderHook(() => usePagination({ ...defaultProps, setCurrentPage }))
      result.current.setCurrentPage(3)
      expect(setCurrentPage).toHaveBeenCalledWith(3)
    })

    it('should pass through truncableText', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, truncableText: '…' }))
      expect(result.current.truncableText).toBe('…')
    })

    it('should pass through truncableClassName', () => {
      const { result } = renderHook(() => usePagination({ ...defaultProps, truncableClassName: 'custom-trunc' }))
      expect(result.current.truncableClassName).toBe('custom-trunc')
    })

    it('should use default truncableText', () => {
      const { currentPage, setCurrentPage, totalPages, edgePageCount, middlePagesSiblingCount } = defaultProps
      const { result } = renderHook(() => usePagination({ currentPage, setCurrentPage, totalPages, edgePageCount, middlePagesSiblingCount }))
      expect(result.current.truncableText).toBe('...')
    })
  })
})
