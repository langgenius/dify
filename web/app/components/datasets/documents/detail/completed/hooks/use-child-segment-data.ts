import type { ChildChunkDetail, ChildSegmentsResponse, SegmentDetailModel, SegmentUpdater } from '@/models/datasets'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import {
  useChildSegmentList,
  useChildSegmentListKey,
  useDeleteChildSegment,
  useUpdateChildSegment,
} from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'
import { useDocumentContext } from '../../context'

export type UseChildSegmentDataOptions = {
  searchValue: string
  currentPage: number
  limit: number
  segments: SegmentDetailModel[]
  currChunkId: string
  isFullDocMode: boolean
  onCloseChildSegmentDetail: () => void
  refreshChunkListDataWithDetailChanged: () => void
  updateSegmentInCache: (segmentId: string, updater: (seg: SegmentDetailModel) => SegmentDetailModel) => void
}

export type UseChildSegmentDataReturn = {
  childSegments: ChildChunkDetail[]
  isLoadingChildSegmentList: boolean
  childChunkListData: ReturnType<typeof useChildSegmentList>['data']
  childSegmentListRef: React.RefObject<HTMLDivElement | null>
  needScrollToBottom: React.RefObject<boolean>
  // Operations
  onDeleteChildChunk: (segmentId: string, childChunkId: string) => Promise<void>
  handleUpdateChildChunk: (segmentId: string, childChunkId: string, content: string) => Promise<void>
  onSaveNewChildChunk: (newChildChunk?: ChildChunkDetail) => void
  resetChildList: () => void
  viewNewlyAddedChildChunk: () => void
}

export const useChildSegmentData = (options: UseChildSegmentDataOptions): UseChildSegmentDataReturn => {
  const {
    searchValue,
    currentPage,
    limit,
    segments,
    currChunkId,
    isFullDocMode,
    onCloseChildSegmentDetail,
    refreshChunkListDataWithDetailChanged,
    updateSegmentInCache,
  } = options

  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const queryClient = useQueryClient()

  const datasetId = useDocumentContext(s => s.datasetId) || ''
  const documentId = useDocumentContext(s => s.documentId) || ''
  const parentMode = useDocumentContext(s => s.parentMode)

  const childSegmentListRef = useRef<HTMLDivElement>(null)
  const needScrollToBottom = useRef(false)

  // Build query params
  const queryParams = useMemo(() => ({
    page: currentPage === 0 ? 1 : currentPage,
    limit,
    keyword: searchValue,
  }), [currentPage, limit, searchValue])

  const segmentId = segments[0]?.id || ''

  // Build query key for optimistic updates
  const currentQueryKey = useMemo(() =>
    [...useChildSegmentListKey, datasetId, documentId, segmentId, queryParams], [datasetId, documentId, segmentId, queryParams])

  // Fetch child segment list
  const { isLoading: isLoadingChildSegmentList, data: childChunkListData } = useChildSegmentList(
    {
      datasetId,
      documentId,
      segmentId,
      params: queryParams,
    },
    !isFullDocMode || segments.length === 0,
  )

  // Derive child segments from query data
  const childSegments = useMemo(() => childChunkListData?.data || [], [childChunkListData])

  const invalidChildSegmentList = useInvalid(useChildSegmentListKey)

  // Scroll to bottom when child segments change
  useEffect(() => {
    if (childSegmentListRef.current && needScrollToBottom.current) {
      childSegmentListRef.current.scrollTo({ top: childSegmentListRef.current.scrollHeight, behavior: 'smooth' })
      needScrollToBottom.current = false
    }
  }, [childSegments])

  const resetChildList = useCallback(() => {
    invalidChildSegmentList()
  }, [invalidChildSegmentList])

  // Optimistic update helper for child segments
  const updateChildSegmentInCache = useCallback((
    childChunkId: string,
    updater: (chunk: ChildChunkDetail) => ChildChunkDetail,
  ) => {
    queryClient.setQueryData<ChildSegmentsResponse>(currentQueryKey, (old) => {
      if (!old)
        return old
      return {
        ...old,
        data: old.data.map(chunk => chunk.id === childChunkId ? updater(chunk) : chunk),
      }
    })
  }, [queryClient, currentQueryKey])

  // Mutations
  const { mutateAsync: deleteChildSegment } = useDeleteChildSegment()
  const { mutateAsync: updateChildSegment } = useUpdateChildSegment()

  const onDeleteChildChunk = useCallback(async (segmentIdParam: string, childChunkId: string) => {
    await deleteChildSegment(
      { datasetId, documentId, segmentId: segmentIdParam, childChunkId },
      {
        onSuccess: () => {
          notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
          if (parentMode === 'paragraph') {
            // Update parent segment's child_chunks in cache
            updateSegmentInCache(segmentIdParam, seg => ({
              ...seg,
              child_chunks: seg.child_chunks?.filter(chunk => chunk.id !== childChunkId),
            }))
          }
          else {
            resetChildList()
          }
        },
        onError: () => {
          notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
        },
      },
    )
  }, [datasetId, documentId, parentMode, deleteChildSegment, updateSegmentInCache, resetChildList, t, notify])

  const handleUpdateChildChunk = useCallback(async (
    segmentIdParam: string,
    childChunkId: string,
    content: string,
  ) => {
    const params: SegmentUpdater = { content: '' }
    if (!content.trim()) {
      notify({ type: 'error', message: t('segment.contentEmpty', { ns: 'datasetDocuments' }) })
      return
    }

    params.content = content

    eventEmitter?.emit('update-child-segment')
    await updateChildSegment({ datasetId, documentId, segmentId: segmentIdParam, childChunkId, body: params }, {
      onSuccess: (res) => {
        notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
        onCloseChildSegmentDetail()

        if (parentMode === 'paragraph') {
          // Update parent segment's child_chunks in cache
          updateSegmentInCache(segmentIdParam, seg => ({
            ...seg,
            child_chunks: seg.child_chunks?.map(childSeg =>
              childSeg.id === childChunkId
                ? {
                    ...childSeg,
                    content: res.data.content,
                    type: res.data.type,
                    word_count: res.data.word_count,
                    updated_at: res.data.updated_at,
                  }
                : childSeg,
            ),
          }))
          refreshChunkListDataWithDetailChanged()
        }
        else {
          updateChildSegmentInCache(childChunkId, chunk => ({
            ...chunk,
            content: res.data.content,
            type: res.data.type,
            word_count: res.data.word_count,
            updated_at: res.data.updated_at,
          }))
        }
      },
      onSettled: () => {
        eventEmitter?.emit('update-child-segment-done')
      },
    })
  }, [datasetId, documentId, parentMode, updateChildSegment, notify, eventEmitter, onCloseChildSegmentDetail, updateSegmentInCache, updateChildSegmentInCache, refreshChunkListDataWithDetailChanged, t])

  const onSaveNewChildChunk = useCallback((newChildChunk?: ChildChunkDetail) => {
    if (parentMode === 'paragraph') {
      // Update parent segment's child_chunks in cache
      updateSegmentInCache(currChunkId, seg => ({
        ...seg,
        child_chunks: [...(seg.child_chunks || []), newChildChunk!],
      }))
      refreshChunkListDataWithDetailChanged()
    }
    else {
      resetChildList()
    }
  }, [parentMode, currChunkId, updateSegmentInCache, refreshChunkListDataWithDetailChanged, resetChildList])

  const viewNewlyAddedChildChunk = useCallback(() => {
    const totalPages = childChunkListData?.total_pages || 0
    const total = childChunkListData?.total || 0
    const newPage = Math.ceil((total + 1) / limit)
    needScrollToBottom.current = true

    if (newPage > totalPages)
      return
    resetChildList()
  }, [childChunkListData, limit, resetChildList])

  return {
    childSegments,
    isLoadingChildSegmentList,
    childChunkListData,
    childSegmentListRef,
    needScrollToBottom,
    onDeleteChildChunk,
    handleUpdateChildChunk,
    onSaveNewChildChunk,
    resetChildList,
    viewNewlyAddedChildChunk,
  }
}
