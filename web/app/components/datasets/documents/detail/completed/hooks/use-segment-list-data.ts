import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { SegmentDetailModel, SegmentsResponse, SegmentUpdater } from '@/models/datasets'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { ChunkingMode } from '@/models/datasets'
import {
  useChunkListAllKey,
  useChunkListDisabledKey,
  useChunkListEnabledKey,
  useDeleteSegment,
  useDisableSegment,
  useEnableSegment,
  useSegmentList,
  useSegmentListKey,
  useUpdateSegment,
} from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'
import { formatNumber } from '@/utils/format'
import { useDocumentContext } from '../../context'
import { ProcessStatus } from '../../segment-add'

const DEFAULT_LIMIT = 10

export type UseSegmentListDataOptions = {
  searchValue: string
  selectedStatus: boolean | 'all'
  selectedSegmentIds: string[]
  importStatus: ProcessStatus | string | undefined
  currentPage: number
  limit: number
  onCloseSegmentDetail: () => void
  clearSelection: () => void
}

export type UseSegmentListDataReturn = {
  segments: SegmentDetailModel[]
  isLoadingSegmentList: boolean
  segmentListData: ReturnType<typeof useSegmentList>['data']
  totalText: string
  isFullDocMode: boolean
  segmentListRef: React.RefObject<HTMLDivElement | null>
  needScrollToBottom: React.RefObject<boolean>
  // Operations
  onChangeSwitch: (enable: boolean, segId?: string) => Promise<void>
  onDelete: (segId?: string) => Promise<void>
  handleUpdateSegment: (
    segmentId: string,
    question: string,
    answer: string,
    keywords: string[],
    attachments: FileEntity[],
    summary?: string,
    needRegenerate?: boolean,
  ) => Promise<void>
  resetList: () => void
  viewNewlyAddedChunk: () => void
  invalidSegmentList: () => void
  updateSegmentInCache: (segmentId: string, updater: (seg: SegmentDetailModel) => SegmentDetailModel) => void
}

export const useSegmentListData = (options: UseSegmentListDataOptions): UseSegmentListDataReturn => {
  const {
    searchValue,
    selectedStatus,
    selectedSegmentIds,
    importStatus,
    currentPage,
    limit,
    onCloseSegmentDetail,
    clearSelection,
  } = options

  const { t } = useTranslation()
  const { notify } = useToastContext()
  const pathname = usePathname()
  const { eventEmitter } = useEventEmitterContextContext()
  const queryClient = useQueryClient()

  const datasetId = useDocumentContext(s => s.datasetId) || ''
  const documentId = useDocumentContext(s => s.documentId) || ''
  const docForm = useDocumentContext(s => s.docForm)
  const parentMode = useDocumentContext(s => s.parentMode)

  const segmentListRef = useRef<HTMLDivElement>(null)
  const needScrollToBottom = useRef(false)

  const isFullDocMode = useMemo(() => {
    return docForm === ChunkingMode.parentChild && parentMode === 'full-doc'
  }, [docForm, parentMode])

  // Build query params
  const queryParams = useMemo(() => ({
    page: isFullDocMode ? 1 : currentPage,
    limit: isFullDocMode ? DEFAULT_LIMIT : limit,
    keyword: isFullDocMode ? '' : searchValue,
    enabled: selectedStatus,
  }), [isFullDocMode, currentPage, limit, searchValue, selectedStatus])

  // Build query key for optimistic updates
  const currentQueryKey = useMemo(() =>
    [...useSegmentListKey, datasetId, documentId, queryParams], [datasetId, documentId, queryParams])

  // Fetch segment list
  const { isLoading: isLoadingSegmentList, data: segmentListData } = useSegmentList({
    datasetId,
    documentId,
    params: queryParams,
  })

  // Derive segments from query data
  const segments = useMemo(() => segmentListData?.data || [], [segmentListData])

  // Invalidation hooks
  const invalidSegmentList = useInvalid(useSegmentListKey)
  const invalidChunkListAll = useInvalid(useChunkListAllKey)
  const invalidChunkListEnabled = useInvalid(useChunkListEnabledKey)
  const invalidChunkListDisabled = useInvalid(useChunkListDisabledKey)

  // Scroll to bottom when needed
  useEffect(() => {
    if (segmentListRef.current && needScrollToBottom.current) {
      segmentListRef.current.scrollTo({ top: segmentListRef.current.scrollHeight, behavior: 'smooth' })
      needScrollToBottom.current = false
    }
  }, [segments])

  // Reset list on pathname change
  useEffect(() => {
    clearSelection()
    invalidSegmentList()
  }, [pathname])

  // Reset list on import completion
  useEffect(() => {
    if (importStatus === ProcessStatus.COMPLETED) {
      clearSelection()
      invalidSegmentList()
    }
  }, [importStatus])

  const resetList = useCallback(() => {
    clearSelection()
    invalidSegmentList()
  }, [clearSelection, invalidSegmentList])

  const refreshChunkListWithStatusChanged = useCallback(() => {
    if (selectedStatus === 'all') {
      invalidChunkListDisabled()
      invalidChunkListEnabled()
    }
    else {
      invalidSegmentList()
    }
  }, [selectedStatus, invalidChunkListDisabled, invalidChunkListEnabled, invalidSegmentList])

  const refreshChunkListDataWithDetailChanged = useCallback(() => {
    const refreshMap: Record<string, () => void> = {
      all: () => {
        invalidChunkListDisabled()
        invalidChunkListEnabled()
      },
      true: () => {
        invalidChunkListAll()
        invalidChunkListDisabled()
      },
      false: () => {
        invalidChunkListAll()
        invalidChunkListEnabled()
      },
    }
    refreshMap[String(selectedStatus)]?.()
  }, [selectedStatus, invalidChunkListDisabled, invalidChunkListEnabled, invalidChunkListAll])

  // Optimistic update helper using React Query's setQueryData
  const updateSegmentInCache = useCallback((
    segmentId: string,
    updater: (seg: SegmentDetailModel) => SegmentDetailModel,
  ) => {
    queryClient.setQueryData<SegmentsResponse>(currentQueryKey, (old) => {
      if (!old)
        return old
      return {
        ...old,
        data: old.data.map(seg => seg.id === segmentId ? updater(seg) : seg),
      }
    })
  }, [queryClient, currentQueryKey])

  // Batch update helper
  const updateSegmentsInCache = useCallback((
    segmentIds: string[],
    updater: (seg: SegmentDetailModel) => SegmentDetailModel,
  ) => {
    queryClient.setQueryData<SegmentsResponse>(currentQueryKey, (old) => {
      if (!old)
        return old
      return {
        ...old,
        data: old.data.map(seg => segmentIds.includes(seg.id) ? updater(seg) : seg),
      }
    })
  }, [queryClient, currentQueryKey])

  // Mutations
  const { mutateAsync: enableSegment } = useEnableSegment()
  const { mutateAsync: disableSegment } = useDisableSegment()
  const { mutateAsync: deleteSegment } = useDeleteSegment()
  const { mutateAsync: updateSegment } = useUpdateSegment()

  const onChangeSwitch = useCallback(async (enable: boolean, segId?: string) => {
    const operationApi = enable ? enableSegment : disableSegment
    const targetIds = segId ? [segId] : selectedSegmentIds

    await operationApi({ datasetId, documentId, segmentIds: targetIds }, {
      onSuccess: () => {
        notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
        updateSegmentsInCache(targetIds, seg => ({ ...seg, enabled: enable }))
        refreshChunkListWithStatusChanged()
      },
      onError: () => {
        notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
      },
    })
  }, [datasetId, documentId, selectedSegmentIds, disableSegment, enableSegment, t, notify, updateSegmentsInCache, refreshChunkListWithStatusChanged])

  const onDelete = useCallback(async (segId?: string) => {
    const targetIds = segId ? [segId] : selectedSegmentIds

    await deleteSegment({ datasetId, documentId, segmentIds: targetIds }, {
      onSuccess: () => {
        notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
        resetList()
        if (!segId)
          clearSelection()
      },
      onError: () => {
        notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
      },
    })
  }, [datasetId, documentId, selectedSegmentIds, deleteSegment, resetList, clearSelection, t, notify])

  const handleUpdateSegment = useCallback(async (
    segmentId: string,
    question: string,
    answer: string,
    keywords: string[],
    attachments: FileEntity[],
    summary?: string,
    needRegenerate = false,
  ) => {
    const params: SegmentUpdater = { content: '', attachment_ids: [] }

    // Validate and build params based on doc form
    if (docForm === ChunkingMode.qa) {
      if (!question.trim()) {
        notify({ type: 'error', message: t('segment.questionEmpty', { ns: 'datasetDocuments' }) })
        return
      }
      if (!answer.trim()) {
        notify({ type: 'error', message: t('segment.answerEmpty', { ns: 'datasetDocuments' }) })
        return
      }
      params.content = question
      params.answer = answer
    }
    else {
      if (!question.trim()) {
        notify({ type: 'error', message: t('segment.contentEmpty', { ns: 'datasetDocuments' }) })
        return
      }
      params.content = question
    }

    if (keywords.length)
      params.keywords = keywords

    if (attachments.length) {
      const notAllUploaded = attachments.some(item => !item.uploadedId)
      if (notAllUploaded) {
        notify({ type: 'error', message: t('segment.allFilesUploaded', { ns: 'datasetDocuments' }) })
        return
      }
      params.attachment_ids = attachments.map(item => item.uploadedId!)
    }

    params.summary = summary ?? ''

    if (needRegenerate)
      params.regenerate_child_chunks = needRegenerate

    eventEmitter?.emit('update-segment')
    await updateSegment({ datasetId, documentId, segmentId, body: params }, {
      onSuccess(res) {
        notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
        if (!needRegenerate)
          onCloseSegmentDetail()

        updateSegmentInCache(segmentId, seg => ({
          ...seg,
          answer: res.data.answer,
          content: res.data.content,
          sign_content: res.data.sign_content,
          keywords: res.data.keywords,
          attachments: res.data.attachments,
          summary: res.data.summary,
          word_count: res.data.word_count,
          hit_count: res.data.hit_count,
          enabled: res.data.enabled,
          updated_at: res.data.updated_at,
          child_chunks: res.data.child_chunks,
        }))
        refreshChunkListDataWithDetailChanged()
        eventEmitter?.emit('update-segment-success')
      },
      onSettled() {
        eventEmitter?.emit('update-segment-done')
      },
    })
  }, [datasetId, documentId, docForm, updateSegment, notify, eventEmitter, onCloseSegmentDetail, updateSegmentInCache, refreshChunkListDataWithDetailChanged, t])

  const viewNewlyAddedChunk = useCallback(() => {
    const totalPages = segmentListData?.total_pages || 0
    const total = segmentListData?.total || 0
    const newPage = Math.ceil((total + 1) / limit)
    needScrollToBottom.current = true

    if (newPage > totalPages)
      return
    resetList()
  }, [segmentListData, limit, resetList])

  // Compute total text for display
  const totalText = useMemo(() => {
    const isSearch = searchValue !== '' || selectedStatus !== 'all'
    if (!isSearch) {
      const total = segmentListData?.total ? formatNumber(segmentListData.total) : '--'
      const count = total === '--' ? 0 : segmentListData!.total
      const translationKey = (docForm === ChunkingMode.parentChild && parentMode === 'paragraph')
        ? 'segment.parentChunks' as const
        : 'segment.chunks' as const
      return `${total} ${t(translationKey, { ns: 'datasetDocuments', count })}`
    }
    const total = typeof segmentListData?.total === 'number' ? formatNumber(segmentListData.total) : 0
    const count = segmentListData?.total || 0
    return `${total} ${t('segment.searchResults', { ns: 'datasetDocuments', count })}`
  }, [segmentListData, docForm, parentMode, searchValue, selectedStatus, t])

  return {
    segments,
    isLoadingSegmentList,
    segmentListData,
    totalText,
    isFullDocMode,
    segmentListRef,
    needScrollToBottom,
    onChangeSwitch,
    onDelete,
    handleUpdateSegment,
    resetList,
    viewNewlyAddedChunk,
    invalidSegmentList,
    updateSegmentInCache,
  }
}
