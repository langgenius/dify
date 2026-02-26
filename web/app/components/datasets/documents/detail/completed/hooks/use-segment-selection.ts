import type { SegmentDetailModel } from '@/models/datasets'
import { useCallback, useMemo, useState } from 'react'

export type UseSegmentSelectionReturn = {
  selectedSegmentIds: string[]
  isAllSelected: boolean
  isSomeSelected: boolean
  onSelected: (segId: string) => void
  onSelectedAll: () => void
  onCancelBatchOperation: () => void
  clearSelection: () => void
}

export const useSegmentSelection = (segments: SegmentDetailModel[]): UseSegmentSelectionReturn => {
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([])

  const onSelected = useCallback((segId: string) => {
    setSelectedSegmentIds(prev =>
      prev.includes(segId)
        ? prev.filter(id => id !== segId)
        : [...prev, segId],
    )
  }, [])

  const isAllSelected = useMemo(() => {
    return segments.length > 0 && segments.every(seg => selectedSegmentIds.includes(seg.id))
  }, [segments, selectedSegmentIds])

  const isSomeSelected = useMemo(() => {
    return segments.some(seg => selectedSegmentIds.includes(seg.id))
  }, [segments, selectedSegmentIds])

  const onSelectedAll = useCallback(() => {
    setSelectedSegmentIds((prev) => {
      const currentAllSegIds = segments.map(seg => seg.id)
      const prevSelectedIds = prev.filter(item => !currentAllSegIds.includes(item))
      return [...prevSelectedIds, ...(isAllSelected ? [] : currentAllSegIds)]
    })
  }, [segments, isAllSelected])

  const onCancelBatchOperation = useCallback(() => {
    setSelectedSegmentIds([])
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedSegmentIds([])
  }, [])

  return {
    selectedSegmentIds,
    isAllSelected,
    isSomeSelected,
    onSelected,
    onSelectedAll,
    onCancelBatchOperation,
    clearSelection,
  }
}
