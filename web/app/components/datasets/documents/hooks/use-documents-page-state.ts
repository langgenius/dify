import type { DocumentListResponse } from '@/models/datasets'
import type { SortType } from '@/service/datasets'
import { useDebounce } from 'ahooks'
import { useCallback, useState } from 'react'
import { normalizeStatusForQuery, sanitizeStatusValue } from '../status-filter'
import { useDocumentListQueryState } from './use-document-list-query-state'

export function useDocumentsPageState() {
  const { query, updateQuery } = useDocumentListQueryState()

  const inputValue = query.keyword
  const debouncedSearchValue = useDebounce(query.keyword, { wait: 500 })

  const statusFilterValue = sanitizeStatusValue(query.status)
  const sortValue = query.sort
  const normalizedStatusFilterValue = normalizeStatusForQuery(statusFilterValue)

  const currPage = query.page - 1
  const limit = query.limit

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [timerCanRun, setTimerCanRun] = useState(true)

  const handlePageChange = useCallback((newPage: number) => {
    updateQuery({ page: newPage + 1 })
  }, [updateQuery])

  const handleLimitChange = useCallback((newLimit: number) => {
    updateQuery({ limit: newLimit, page: 1 })
  }, [updateQuery])

  const handleInputChange = useCallback((value: string) => {
    if (value !== query.keyword)
      setSelectedIds([])
    updateQuery({ keyword: value, page: 1 })
  }, [query.keyword, updateQuery])

  const handleStatusFilterChange = useCallback((value: string) => {
    const selectedValue = sanitizeStatusValue(value)
    setSelectedIds([])
    updateQuery({ status: selectedValue, page: 1 })
  }, [updateQuery])

  const handleStatusFilterClear = useCallback(() => {
    if (statusFilterValue === 'all')
      return
    setSelectedIds([])
    updateQuery({ status: 'all', page: 1 })
  }, [statusFilterValue, updateQuery])

  const handleSortChange = useCallback((value: string) => {
    const next = value as SortType
    if (next === sortValue)
      return
    updateQuery({ sort: next, page: 1 })
  }, [sortValue, updateQuery])

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

  const adjustPageForTotal = useCallback((documentsRes: DocumentListResponse | undefined) => {
    if (!documentsRes)
      return
    const totalPages = Math.ceil(documentsRes.total / limit)
    if (currPage > 0 && currPage + 1 > totalPages)
      handlePageChange(totalPages > 0 ? totalPages - 1 : 0)
  }, [limit, currPage, handlePageChange])

  return {
    inputValue,
    debouncedSearchValue,
    handleInputChange,

    statusFilterValue,
    sortValue,
    normalizedStatusFilterValue,
    handleStatusFilterChange,
    handleStatusFilterClear,
    handleSortChange,

    currPage,
    limit,
    handlePageChange,
    handleLimitChange,

    selectedIds,
    setSelectedIds,

    timerCanRun,
    updatePollingState,
    adjustPageForTotal,
  }
}
