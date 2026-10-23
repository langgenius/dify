import type { SortType } from '@/service/datasets'
import { useCallback } from 'react'

type RemoteSortField = 'hit_count' | 'created_at'

export type SortField = RemoteSortField | null
export type SortOrder = 'asc' | 'desc'

type UseDocumentSortOptions = {
  remoteSortValue: string
  onRemoteSortChange: (nextSortValue: SortType) => void
}

export const useDocumentSort = ({
  remoteSortValue,
  onRemoteSortChange,
}: UseDocumentSortOptions) => {
  const sortOrder: SortOrder = remoteSortValue.startsWith('-') ? 'desc' : 'asc'
  const sortKey = remoteSortValue.startsWith('-') ? remoteSortValue.slice(1) : remoteSortValue

  const sortField: SortField = sortKey === 'hit_count' || sortKey === 'created_at' ? sortKey : null

  const handleSort = useCallback(
    (field: SortField) => {
      if (!field) return

      if (sortField === field) {
        const nextSortOrder = sortOrder === 'desc' ? 'asc' : 'desc'
        onRemoteSortChange(nextSortOrder === 'desc' ? `-${field}` : field)
        return
      }
      onRemoteSortChange(`-${field}`)
    },
    [onRemoteSortChange, sortField, sortOrder],
  )

  return {
    sortField,
    sortOrder,
    handleSort,
  }
}
