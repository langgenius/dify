import type { DocumentListResponse } from '@/models/datasets'
import type { SortType } from '@/service/datasets'
import { useDebounce, useDebounceFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { normalizeStatusForQuery, sanitizeStatusValue } from '../status-filter'
import useDocumentListQueryState from './use-document-list-query-state'

/**
 * Custom hook to manage documents page state including:
 * - Search state (input value, debounced search value)
 * - Filter state (status filter, sort value)
 * - Pagination state (current page, limit)
 * - Selection state (selected document ids)
 * - Polling state (timer control for auto-refresh)
 */
export function useDocumentsPageState() {
  const { query, updateQuery } = useDocumentListQueryState()

  // Search state
  const [inputValue, setInputValue] = useState<string>('')
  const [searchValue, setSearchValue] = useState<string>('')
  const debouncedSearchValue = useDebounce(searchValue, { wait: 500 })

  // Filter & sort state
  const [statusFilterValue, setStatusFilterValue] = useState<string>(() => sanitizeStatusValue(query.status))
  const [sortValue, setSortValue] = useState<SortType>(query.sort)
  const normalizedStatusFilterValue = useMemo(
    () => normalizeStatusForQuery(statusFilterValue),
    [statusFilterValue],
  )

  // Pagination state
  const [currPage, setCurrPage] = useState<number>(query.page - 1)
  const [limit, setLimit] = useState<number>(query.limit)

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Polling state
  const [timerCanRun, setTimerCanRun] = useState(true)

  // Initialize search value from URL on mount
  useEffect(() => {
    if (query.keyword) {
      setInputValue(query.keyword)
      setSearchValue(query.keyword)
    }
  }, []) // Only run on mount

  // Sync local state with URL query changes
  useEffect(() => {
    setCurrPage(query.page - 1)
    setLimit(query.limit)
    if (query.keyword !== searchValue) {
      setInputValue(query.keyword)
      setSearchValue(query.keyword)
    }
    setStatusFilterValue((prev) => {
      const nextValue = sanitizeStatusValue(query.status)
      return prev === nextValue ? prev : nextValue
    })
    setSortValue(query.sort)
  }, [query])

  // Update URL when search changes
  useEffect(() => {
    if (debouncedSearchValue !== query.keyword) {
      setCurrPage(0)
      updateQuery({ keyword: debouncedSearchValue, page: 1 })
    }
  }, [debouncedSearchValue, query.keyword, updateQuery])

  // Clear selection when search changes
  useEffect(() => {
    if (searchValue !== query.keyword)
      setSelectedIds([])
  }, [searchValue, query.keyword])

  // Clear selection when status filter changes
  useEffect(() => {
    setSelectedIds([])
  }, [normalizedStatusFilterValue])

  // Page change handler
  const handlePageChange = useCallback((newPage: number) => {
    setCurrPage(newPage)
    updateQuery({ page: newPage + 1 })
  }, [updateQuery])

  // Limit change handler
  const handleLimitChange = useCallback((newLimit: number) => {
    setLimit(newLimit)
    setCurrPage(0)
    updateQuery({ limit: newLimit, page: 1 })
  }, [updateQuery])

  // Debounced search handler
  const { run: handleSearch } = useDebounceFn(() => {
    setSearchValue(inputValue)
  }, { wait: 500 })

  // Input change handler
  const handleInputChange = useCallback((value: string) => {
    setInputValue(value)
    handleSearch()
  }, [handleSearch])

  // Status filter change handler
  const handleStatusFilterChange = useCallback((value: string) => {
    const selectedValue = sanitizeStatusValue(value)
    setStatusFilterValue(selectedValue)
    setCurrPage(0)
    updateQuery({ status: selectedValue, page: 1 })
  }, [updateQuery])

  // Status filter clear handler
  const handleStatusFilterClear = useCallback(() => {
    if (statusFilterValue === 'all')
      return
    setStatusFilterValue('all')
    setCurrPage(0)
    updateQuery({ status: 'all', page: 1 })
  }, [statusFilterValue, updateQuery])

  // Sort change handler
  const handleSortChange = useCallback((value: string) => {
    const next = value as SortType
    if (next === sortValue)
      return
    setSortValue(next)
    setCurrPage(0)
    updateQuery({ sort: next, page: 1 })
  }, [sortValue, updateQuery])

  // Update polling state based on documents response
  const updatePollingState = useCallback((documentsRes: DocumentListResponse | undefined) => {
    if (!documentsRes?.data)
      return

    let completedNum = 0
    documentsRes.data.forEach((documentItem) => {
      const { indexing_status } = documentItem
      const isEmbedded = indexing_status === 'completed' || indexing_status === 'paused' || indexing_status === 'error'
      if (isEmbedded)
        completedNum++
    })

    const hasIncompleteDocuments = completedNum !== documentsRes.data.length
    const transientStatuses = ['queuing', 'indexing', 'paused']
    const shouldForcePolling = normalizedStatusFilterValue === 'all'
      ? false
      : transientStatuses.includes(normalizedStatusFilterValue)
    setTimerCanRun(shouldForcePolling || hasIncompleteDocuments)
  }, [normalizedStatusFilterValue])

  // Adjust page when total pages change
  const adjustPageForTotal = useCallback((documentsRes: DocumentListResponse | undefined) => {
    if (!documentsRes)
      return
    const totalPages = Math.ceil(documentsRes.total / limit)
    if (currPage > 0 && currPage + 1 > totalPages)
      handlePageChange(totalPages > 0 ? totalPages - 1 : 0)
  }, [limit, currPage, handlePageChange])

  return {
    // Search state
    inputValue,
    searchValue,
    debouncedSearchValue,
    handleInputChange,

    // Filter & sort state
    statusFilterValue,
    sortValue,
    normalizedStatusFilterValue,
    handleStatusFilterChange,
    handleStatusFilterClear,
    handleSortChange,

    // Pagination state
    currPage,
    limit,
    handlePageChange,
    handleLimitChange,

    // Selection state
    selectedIds,
    setSelectedIds,

    // Polling state
    timerCanRun,
    updatePollingState,
    adjustPageForTotal,
  }
}

export default useDocumentsPageState
