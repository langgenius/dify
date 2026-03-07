import { useCallback, useMemo } from 'react'

type RemoteSortField = 'hit_count' | 'created_at'
const REMOTE_SORT_FIELDS = new Set<RemoteSortField>(['hit_count', 'created_at'])

export type SortField = RemoteSortField | null
export type SortOrder = 'asc' | 'desc'

type UseDocumentSortOptions = {
  remoteSortValue: string
  onRemoteSortChange: (nextSortValue: string) => void
}

export const useDocumentSort = ({
  remoteSortValue,
  onRemoteSortChange,
}: UseDocumentSortOptions) => {
  const sortOrder: SortOrder = remoteSortValue.startsWith('-') ? 'desc' : 'asc'
  const sortKey = remoteSortValue.startsWith('-') ? remoteSortValue.slice(1) : remoteSortValue

  const sortField = useMemo<SortField>(() => {
    return REMOTE_SORT_FIELDS.has(sortKey as RemoteSortField) ? sortKey as RemoteSortField : null
  }, [sortKey])

  const handleSort = useCallback((field: SortField) => {
    if (!field)
      return

    if (sortField === field) {
      const nextSortOrder = sortOrder === 'desc' ? 'asc' : 'desc'
      onRemoteSortChange(nextSortOrder === 'desc' ? `-${field}` : field)
      return
    }
    onRemoteSortChange(`-${field}`)
  }, [onRemoteSortChange, sortField, sortOrder])

  return {
    sortField,
    sortOrder,
    handleSort,
  }
}
