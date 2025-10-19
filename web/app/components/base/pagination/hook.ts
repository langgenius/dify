import React, { useCallback } from 'react'
import type { IPaginationProps, IUsePagination } from './type'

const usePagination = ({
  currentPage,
  setCurrentPage,
  truncableText = '...',
  truncableClassName = '',
  totalPages,
  edgePageCount,
  middlePagesSiblingCount,
}: IPaginationProps): IUsePagination => {
  const pages = React.useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages])

  const hasPreviousPage = currentPage > 1
  const hasNextPage = currentPage < totalPages

  const isReachedToFirst = currentPage <= middlePagesSiblingCount
  const isReachedToLast = currentPage + middlePagesSiblingCount >= totalPages

  const middlePages = React.useMemo(() => {
    const middlePageCount = middlePagesSiblingCount * 2 + 1
    if (isReachedToFirst)
      return pages.slice(0, middlePageCount)

    if (isReachedToLast)
      return pages.slice(-middlePageCount)

    return pages.slice(
      currentPage - middlePagesSiblingCount,
      currentPage + middlePagesSiblingCount + 1,
    )
  }, [currentPage, isReachedToFirst, isReachedToLast, middlePagesSiblingCount, pages])

  const getAllPreviousPages = useCallback(() => {
    return pages.slice(0, middlePages[0] - 1)
  }, [middlePages, pages])

  const previousPages = React.useMemo(() => {
    if (isReachedToFirst || getAllPreviousPages().length < 1)
      return []

    return pages
      .slice(0, edgePageCount)
      .filter(p => !middlePages.includes(p))
  }, [edgePageCount, getAllPreviousPages, isReachedToFirst, middlePages, pages])

  const getAllNextPages = React.useMemo(() => {
    return pages.slice(
      middlePages[middlePages.length - 1],
      pages[pages.length],
    )
  }, [pages, middlePages])

  const nextPages = React.useMemo(() => {
    if (isReachedToLast)
      return []

    if (getAllNextPages.length < 1)
      return []

    return pages
      .slice(pages.length - edgePageCount, pages.length)
      .filter(p => !middlePages.includes(p))
  }, [edgePageCount, getAllNextPages.length, isReachedToLast, middlePages, pages])

  const isPreviousTruncable = React.useMemo(() => {
    // Is truncable if first value of middlePage is larger than last value of previousPages
    return middlePages[0] > previousPages[previousPages.length - 1] + 1
  }, [previousPages, middlePages])

  const isNextTruncable = React.useMemo(() => {
    // Is truncable if last value of middlePage is larger than first value of previousPages
    return middlePages[middlePages.length - 1] + 1 < nextPages[0]
  }, [nextPages, middlePages])

  return {
    currentPage,
    setCurrentPage,
    truncableText,
    truncableClassName,
    pages,
    hasPreviousPage,
    hasNextPage,
    previousPages,
    isPreviousTruncable,
    middlePages,
    isNextTruncable,
    nextPages,
  }
}

export default usePagination
