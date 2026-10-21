import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { SortType } from '@/service/datasets'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
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

  const [selectedDocuments, setSelectedDocuments] = useState<DocumentWithSegmentsResponse[]>([])
  const selectedIds = useMemo(() => selectedDocuments.map(({ id }) => id), [selectedDocuments])

  const clearSelectedDocuments = useCallback(() => setSelectedDocuments([]), [])

  const updateSelectedDocuments = useCallback(
    (visibleDocuments: DocumentWithSegmentsResponse[], nextSelectedIds: string[]) => {
      const visibleIds = new Set(visibleDocuments.map(({ id }) => id))
      const nextSelectedSet = new Set(nextSelectedIds)
      setSelectedDocuments((currentDocuments) => [
        ...currentDocuments.filter(({ id }) => !visibleIds.has(id)),
        ...visibleDocuments.filter(({ id }) => nextSelectedSet.has(id)),
      ])
    },
    [],
  )

  const removeSelectedDocuments = useCallback((documentIds: string[]) => {
    const removedIds = new Set(documentIds)
    setSelectedDocuments((currentDocuments) =>
      currentDocuments.filter(({ id }) => !removedIds.has(id)),
    )
  }, [])

  const handlePageChange = useCallback(
    (newPage: number) => {
      updateQuery({ page: newPage + 1 })
    },
    [updateQuery],
  )

  const handleLimitChange = useCallback(
    (newLimit: number) => {
      updateQuery({ limit: newLimit, page: 1 })
    },
    [updateQuery],
  )

  const handleInputChange = useCallback(
    (value: string) => {
      if (value !== query.keyword) clearSelectedDocuments()
      updateQuery({ keyword: value, page: 1 })
    },
    [clearSelectedDocuments, query.keyword, updateQuery],
  )

  const handleStatusFilterChange = useCallback(
    (value: string) => {
      const selectedValue = sanitizeStatusValue(value)
      clearSelectedDocuments()
      updateQuery({ status: selectedValue, page: 1 })
    },
    [clearSelectedDocuments, updateQuery],
  )

  const handleStatusFilterClear = useCallback(() => {
    if (statusFilterValue === 'all') return
    clearSelectedDocuments()
    updateQuery({ status: 'all', page: 1 })
  }, [clearSelectedDocuments, statusFilterValue, updateQuery])

  const handleSortChange = useCallback(
    (value: string) => {
      const next = value as SortType
      if (next === sortValue) return
      updateQuery({ sort: next, page: 1 })
    },
    [sortValue, updateQuery],
  )

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
    selectedDocuments,
    updateSelectedDocuments,
    removeSelectedDocuments,
    clearSelectedDocuments,
  }
}
