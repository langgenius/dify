'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounceFn } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { useDocumentContext } from '../index'
import { ProcessStatus } from '../segment-add'
import s from './style.module.css'
import SegmentList from './segment-list'
import DisplayToggle from './display-toggle'
import BatchAction from './batch-action'
import SegmentDetail from './segment-detail'
import SegmentCard from './segment-card'
import ChildSegmentList from './child-segment-list'
import FullScreenDrawer from './common/full-screen-drawer'
import Pagination from '@/app/components/base/pagination'
import cn from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { ToastContext } from '@/app/components/base/toast'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect } from '@/app/components/base/select'
import { updateSegment } from '@/service/datasets'
import type { ChildChunkDetail, SegmentDetailModel, SegmentUpdater } from '@/models/datasets'
import NewSegment from '@/app/components/datasets/documents/detail/new-segment'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import Checkbox from '@/app/components/base/checkbox'
import { useChildSegmentList, useDeleteSegment, useDisableSegment, useEnableSegment, useSegmentList, useSegmentListKey } from '@/service/knowledge/use-segment'
import { Chunk } from '@/app/components/base/icons/src/public/knowledge'
import { useInvalid } from '@/service/use-base'

const DEFAULT_LIMIT = 10

type SegmentListContextValue = {
  isCollapsed: boolean
  toggleCollapsed: () => void
  fullScreen: boolean
  toggleFullScreen: () => void
}

const SegmentListContext = createContext({
  isCollapsed: true,
  toggleCollapsed: () => {},
  fullScreen: false,
  toggleFullScreen: () => {},
})

export const useSegmentListContext = (selector: (value: SegmentListContextValue) => any) => {
  return useContextSelector(SegmentListContext, selector)
}

export const SegmentIndexTag: FC<{ positionId?: string | number; label?: string; className?: string }> = React.memo(({ positionId, label, className }) => {
  const localPositionId = useMemo(() => {
    const positionIdStr = String(positionId)
    if (positionIdStr.length >= 3)
      return `Chunk-${positionId}`
    return `Chunk-${positionIdStr.padStart(2, '0')}`
  }, [positionId])
  return (
    <div className={cn('flex items-center', className)}>
      <Chunk className='w-3 h-3 p-[1px] text-text-tertiary mr-0.5' />
      <div className='text-text-tertiary system-xs-medium'>
        {label || localPositionId}
      </div>
    </div>
  )
})

SegmentIndexTag.displayName = 'SegmentIndexTag'

type ICompletedProps = {
  embeddingAvailable: boolean
  showNewSegmentModal: boolean
  onNewSegmentModalChange: (state: boolean) => void
  importStatus: ProcessStatus | string | undefined
  archived?: boolean
}
/**
 * Embedding done, show list of all segments
 * Support search and filter
 */
const Completed: FC<ICompletedProps> = ({
  embeddingAvailable,
  showNewSegmentModal,
  onNewSegmentModalChange,
  importStatus,
  archived,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [datasetId = '', documentId = '', docForm, mode, parentMode] = useDocumentContext(s => [s.datasetId, s.documentId, s.docForm, s.mode, s.parentMode])
  // the current segment id and whether to show the modal
  const [currSegment, setCurrSegment] = useState<{ segInfo?: SegmentDetailModel; showModal: boolean; isEditMode?: boolean }>({ showModal: false })

  const [inputValue, setInputValue] = useState<string>('') // the input value
  const [searchValue, setSearchValue] = useState<string>('') // the search value
  const [selectedStatus, setSelectedStatus] = useState<boolean | 'all'>('all') // the selected status, enabled/disabled/undefined

  const [segments, setSegments] = useState<SegmentDetailModel[]>([]) // all segments data
  const [childSegments, setChildSegments] = useState<ChildChunkDetail[]>([]) // all child segments data
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([])
  const { eventEmitter } = useEventEmitterContextContext()
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [currentPage, setCurrentPage] = useState(1) // start from 1
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [fullScreen, setFullScreen] = useState(false)
  const segmentListRef = useRef<HTMLDivElement>(null)
  const needScrollToBottom = useRef(false)

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchValue(inputValue)
  }, { wait: 500 })

  const handleInputChange = (value: string) => {
    setInputValue(value)
    handleSearch()
  }

  const onChangeStatus = ({ value }: Item) => {
    setSelectedStatus(value === 'all' ? 'all' : !!value)
  }

  const isFullDocMode = useMemo(() => {
    return mode === 'hierarchical' && parentMode === 'full-doc'
  }, [mode, parentMode])

  const { isFetching: isLoadingSegmentList, data: segmentListData } = useSegmentList(
    {
      datasetId,
      documentId,
      params: {
        page: currentPage,
        limit,
        keyword: isFullDocMode ? '' : searchValue,
        enabled: selectedStatus === 'all' ? 'all' : !!selectedStatus,
      },
    },
  )
  const invalidSegmentList = useInvalid(useSegmentListKey)

  useEffect(() => {
    if (segmentListData) {
      setSegments(segmentListData.data || [])
      if (segmentListData.total_pages < currentPage)
        setCurrentPage(segmentListData.total_pages)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentListData])

  useEffect(() => {
    if (segmentListRef.current && needScrollToBottom.current) {
      segmentListRef.current.scrollTo({ top: segmentListRef.current.scrollHeight, behavior: 'smooth' })
      needScrollToBottom.current = false
    }
  }, [segments])

  const { data: childChunkListData, refetch: refreshChildSegmentList } = useChildSegmentList(
    {
      datasetId,
      documentId,
      segmentId: segments[0]?.id || '',
      params: {
        page: currentPage,
        limit,
        keyword: searchValue,
      },
    },
    !isFullDocMode || segments.length === 0,
  )

  useEffect(() => {
    if (childChunkListData)
      setChildSegments(childChunkListData.data || [])
  }, [childChunkListData])

  const resetList = useCallback(() => {
    setSegments([])
    setSelectedSegmentIds([])
    invalidSegmentList()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onClickCard = (detail: SegmentDetailModel, isEditMode = false) => {
    setCurrSegment({ segInfo: detail, showModal: true, isEditMode })
  }

  const onCloseDrawer = () => {
    setCurrSegment({ ...currSegment, showModal: false })
    setFullScreen(false)
  }

  const { mutateAsync: enableSegment } = useEnableSegment()
  const { mutateAsync: disableSegment } = useDisableSegment()

  const onChangeSwitch = useCallback(async (enable: boolean, segId?: string) => {
    const operationApi = enable ? enableSegment : disableSegment
    await operationApi({ datasetId, documentId, segmentIds: segId ? [segId] : selectedSegmentIds }, {
      onSuccess: () => {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        for (const seg of segments) {
          if (segId ? seg.id === segId : selectedSegmentIds.includes(seg.id))
            seg.enabled = enable
        }
        setSegments([...segments])
      },
      onError: () => {
        notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, documentId, selectedSegmentIds, segments])

  const { mutateAsync: deleteSegment } = useDeleteSegment()

  const onDelete = useCallback(async (segId?: string) => {
    await deleteSegment({ datasetId, documentId, segmentIds: segId ? [segId] : selectedSegmentIds }, {
      onSuccess: () => {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        resetList()
        !segId && setSelectedSegmentIds([])
      },
      onError: () => {
        notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, documentId, selectedSegmentIds])

  const handleUpdateSegment = async (
    segmentId: string,
    question: string,
    answer: string,
    keywords: string[],
    needRegenerate = false,
  ) => {
    const params: SegmentUpdater = { content: '' }
    if (docForm === 'qa_model') {
      if (!question.trim())
        return notify({ type: 'error', message: t('datasetDocuments.segment.questionEmpty') })
      if (!answer.trim())
        return notify({ type: 'error', message: t('datasetDocuments.segment.answerEmpty') })

      params.content = question
      params.answer = answer
    }
    else {
      if (!question.trim())
        return notify({ type: 'error', message: t('datasetDocuments.segment.contentEmpty') })

      params.content = question
    }

    if (keywords.length)
      params.keywords = keywords

    if (needRegenerate)
      params.regenerate_child_chunks = needRegenerate

    try {
      eventEmitter?.emit('update-segment')
      const res = await updateSegment({ datasetId, documentId, segmentId, body: params })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      if (!needRegenerate)
        onCloseDrawer()
      for (const seg of segments) {
        if (seg.id === segmentId) {
          seg.answer = res.data.answer
          seg.content = res.data.content
          seg.keywords = res.data.keywords
          seg.word_count = res.data.word_count
          seg.hit_count = res.data.hit_count
          seg.enabled = res.data.enabled
          seg.updated_at = res.data.updated_at
          seg.child_chunks = res.data.child_chunks
        }
      }
      setSegments([...segments])
      eventEmitter?.emit('update-segment-success')
    }
    finally {
      eventEmitter?.emit('update-segment-done')
    }
  }

  useEffect(() => {
    if (importStatus === ProcessStatus.COMPLETED)
      resetList()
  }, [importStatus, resetList])

  const onCancelBatchOperation = useCallback(() => {
    setSelectedSegmentIds([])
  }, [])

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
      return [...prevSelectedIds, ...((isAllSelected || selectedSegmentIds.length > 0) ? [] : currentAllSegIds)]
    })
  }, [segments, isAllSelected, selectedSegmentIds])

  const totalText = useMemo(() => {
    return segmentListData?.total ? formatNumber(segmentListData.total) : '--'
  }, [segmentListData?.total])

  const toggleFullScreen = useCallback(() => {
    setFullScreen(!fullScreen)
  }, [fullScreen])

  const viewNewlyAddedChunk = useCallback(async () => {
    const totalPages = segmentListData?.total_pages || 0
    const total = segmentListData?.total || 0
    const newPage = Math.ceil((total + 1) / limit)
    needScrollToBottom.current = true
    if (newPage > totalPages) {
      setCurrentPage(totalPages + 1)
    }
    else {
      resetList()
      currentPage !== totalPages && setCurrentPage(totalPages)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentListData, limit, currentPage])

  return (
    <SegmentListContext.Provider value={{
      isCollapsed,
      toggleCollapsed: () => setIsCollapsed(!isCollapsed),
      fullScreen,
      toggleFullScreen,
    }}>
      {/* Menu Bar */}
      {!isFullDocMode && <div className={s.docSearchWrapper}>
        <Checkbox
          className='shrink-0'
          checked={isAllSelected}
          mixed={!isAllSelected && isSomeSelected}
          onCheck={onSelectedAll}
        />
        <div className={cn('system-sm-semibold-uppercase pl-5', s.totalText)}>{totalText} {t('datasetDocuments.segment.chunks')}</div>
        <SimpleSelect
          onSelect={onChangeStatus}
          items={[
            { value: 'all', name: t('datasetDocuments.list.index.all') },
            { value: 0, name: t('datasetDocuments.list.status.disabled') },
            { value: 1, name: t('datasetDocuments.list.status.enabled') },
          ]}
          defaultValue={'all'}
          className={s.select}
          wrapperClassName='h-fit w-[100px] mr-2' />
        <Input
          showLeftIcon
          showClearIcon
          wrapperClassName='!w-52'
          value={inputValue}
          onChange={e => handleInputChange(e.target.value)}
          onClear={() => handleInputChange('')}
        />
        <Divider type='vertical' className='h-3.5 mx-3' />
        <DisplayToggle />
      </div>}
      {/* Segment list */}
      {
        isFullDocMode
          ? <div className='h-full flex flex-col'>
            <SegmentCard
              detail={segments[0]}
              onClick={() => onClickCard(segments[0])}
              loading={false}
            />
            <ChildSegmentList
              childChunks={childSegments}
              handleInputChange={() => {}}
              enabled={!archived}
            />
          </div>
          : <SegmentList
            ref={segmentListRef}
            embeddingAvailable={embeddingAvailable}
            isLoading={isLoadingSegmentList}
            items={segments}
            selectedSegmentIds={selectedSegmentIds}
            onSelected={onSelected}
            onChangeSwitch={onChangeSwitch}
            onDelete={onDelete}
            onClick={onClickCard}
            archived={archived}
          />
      }
      {/* Pagination */}
      <Pagination
        current={currentPage - 1}
        onChange={cur => setCurrentPage(cur + 1)}
        total={segmentListData?.total || 0}
        limit={limit}
        onLimitChange={limit => setLimit(limit)}
      />
      {/* Edit or view segment detail */}
      <FullScreenDrawer
        isOpen={currSegment.showModal}
        fullScreen={fullScreen}
      >
        <SegmentDetail
          segInfo={currSegment.segInfo ?? { id: '' }}
          docForm={docForm}
          isEditMode={currSegment.isEditMode}
          onUpdate={handleUpdateSegment}
          onCancel={onCloseDrawer}
        />
      </FullScreenDrawer>
      {/* Create New Segment */}
      <FullScreenDrawer
        isOpen={showNewSegmentModal}
        fullScreen={fullScreen}
      >
        <NewSegment
          docForm={docForm}
          onCancel={() => {
            onNewSegmentModalChange(false)
            setFullScreen(false)
          }}
          onSave={resetList}
          viewNewlyAddedChunk={viewNewlyAddedChunk}
        />
      </FullScreenDrawer>
      {/* Batch Action Buttons */}
      {selectedSegmentIds.length > 0
      && <BatchAction
        className='absolute left-0 bottom-16 z-20'
        selectedIds={selectedSegmentIds}
        onBatchEnable={onChangeSwitch.bind(null, true, '')}
        onBatchDisable={onChangeSwitch.bind(null, false, '')}
        onBatchDelete={onDelete.bind(null, '')}
        onCancel={onCancelBatchOperation}
      />}
    </SegmentListContext.Provider>
  )
}

export default Completed
