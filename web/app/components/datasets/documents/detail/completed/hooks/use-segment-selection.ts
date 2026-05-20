import { useCallback, useState } from 'react'

type UseSegmentSelectionReturn = {
  selectedSegmentIds: string[]
  onSelectedSegmentIdsChange: (segmentIds: string[]) => void
  onCancelBatchOperation: () => void
  clearSelection: () => void
}

type MergeCurrentPageSelectedSegmentIdsOptions = {
  selectedSegmentIds: string[]
  currentPageSegmentIds: string[]
  nextCurrentPageSelectedSegmentIds: string[]
}

export const mergeCurrentPageSelectedSegmentIds = ({
  selectedSegmentIds,
  currentPageSegmentIds,
  nextCurrentPageSelectedSegmentIds,
}: MergeCurrentPageSelectedSegmentIdsOptions) => {
  const currentPageSegmentIdSet = new Set(currentPageSegmentIds)
  const selectedSegmentIdsOutsideCurrentPage = selectedSegmentIds.filter(segmentId => !currentPageSegmentIdSet.has(segmentId))

  return [
    ...selectedSegmentIdsOutsideCurrentPage,
    ...nextCurrentPageSelectedSegmentIds,
  ]
}

export const useSegmentSelection = (): UseSegmentSelectionReturn => {
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([])

  const onSelectedSegmentIdsChange = useCallback((segmentIds: string[]) => {
    setSelectedSegmentIds(segmentIds)
  }, [])

  const onCancelBatchOperation = useCallback(() => {
    setSelectedSegmentIds([])
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedSegmentIds([])
  }, [])

  return {
    selectedSegmentIds,
    onSelectedSegmentIdsChange,
    onCancelBatchOperation,
    clearSelection,
  }
}
