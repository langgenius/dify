import type { SimpleDocumentDetail } from '@/models/datasets'
import { useCallback, useMemo, useRef, useState } from 'react'
import { normalizeStatusForQuery } from '@/app/components/datasets/documents/status-filter'

export type SortField = 'name' | 'word_count' | 'hit_count' | 'created_at' | null
export type SortOrder = 'asc' | 'desc'

type LocalDoc = SimpleDocumentDetail & { percent?: number }

type UseDocumentSortOptions = {
  documents: LocalDoc[]
  statusFilterValue: string
  remoteSortValue: string
}

export const useDocumentSort = ({
  documents,
  statusFilterValue,
  remoteSortValue,
}: UseDocumentSortOptions) => {
  const [sortField, setSortField] = useState<SortField>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const prevRemoteSortValueRef = useRef(remoteSortValue)

  // Reset sort when remote sort changes
  if (prevRemoteSortValueRef.current !== remoteSortValue) {
    prevRemoteSortValueRef.current = remoteSortValue
    setSortField(null)
    setSortOrder('desc')
  }

  const handleSort = useCallback((field: SortField) => {
    if (field === null)
      return

    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    }
    else {
      setSortField(field)
      setSortOrder('desc')
    }
  }, [sortField])

  const sortedDocuments = useMemo(() => {
    let filteredDocs = documents

    if (statusFilterValue && statusFilterValue !== 'all') {
      filteredDocs = filteredDocs.filter(doc =>
        typeof doc.display_status === 'string'
        && normalizeStatusForQuery(doc.display_status) === statusFilterValue,
      )
    }

    if (!sortField)
      return filteredDocs

    const sortedDocs = [...filteredDocs].sort((a, b) => {
      let aValue: string | number
      let bValue: string | number

      switch (sortField) {
        case 'name':
          aValue = a.name?.toLowerCase() || ''
          bValue = b.name?.toLowerCase() || ''
          break
        case 'word_count':
          aValue = a.word_count || 0
          bValue = b.word_count || 0
          break
        case 'hit_count':
          aValue = a.hit_count || 0
          bValue = b.hit_count || 0
          break
        case 'created_at':
          aValue = a.created_at
          bValue = b.created_at
          break
        default:
          return 0
      }

      if (sortField === 'name') {
        const result = (aValue as string).localeCompare(bValue as string)
        return sortOrder === 'asc' ? result : -result
      }
      else {
        const result = (aValue as number) - (bValue as number)
        return sortOrder === 'asc' ? result : -result
      }
    })

    return sortedDocs
  }, [documents, sortField, sortOrder, statusFilterValue])

  return {
    sortField,
    sortOrder,
    handleSort,
    sortedDocuments,
  }
}
