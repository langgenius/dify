'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounceFn } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { usePathname } from 'next/navigation'
import { useDocumentContext } from '../index'
import { ProcessStatus } from '../segment-add'
import s from './style.module.css'
import SegmentList from './segment-list'
import DisplayToggle from './display-toggle'
import BatchAction from './common/batch-action'
import SegmentDetail from './segment-detail'
import SegmentCard from './segment-card'
import ChildSegmentList from './child-segment-list'
import NewChildSegment from './new-child-segment'
import FullScreenDrawer from './common/full-screen-drawer'
import ChildSegmentDetail from './child-segment-detail'
import StatusItem from './status-item'
import Pagination from '@/app/components/base/pagination'
import cn from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { ToastContext } from '@/app/components/base/toast'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect } from '@/app/components/base/select'
import { type ChildChunkDetail, ChunkingMode, type SegmentDetailModel, type SegmentUpdater } from '@/models/datasets'
import NewSegment from '@/app/components/datasets/documents/detail/new-segment'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import Checkbox from '@/app/components/base/checkbox'
import {
  useChildSegmentList,
  useChildSegmentListKey,
  useChunkListAllKey,
  useChunkListDisabledKey,
  useChunkListEnabledKey,
  useDeleteChildSegment,
  useDeleteSegment,
  useDisableSegment,
  useEnableSegment,
  useSegmentList,
  useSegmentListKey,
  useUpdateChildSegment,
  useUpdateSegment,
} from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'

const DEFAULT_LIMIT = 10

type CurrSegmentType = {
  segInfo?: SegmentDetailModel
  showModal: boolean
  isEditMode?: boolean
}

type CurrChildChunkType = {
  childChunkInfo?: ChildChunkDetail
  showModal: boolean
}

type SegmentListContextValue = {
  isCollapsed: boolean
  fullScreen: boolean
  toggleFullScreen: (fullscreen?: boolean) => void
  currSegment: CurrSegmentType
  currChildChunk: CurrChildChunkType
}

const SegmentListContext = createContext<SegmentListContextValue>({
  isCollapsed: true,
  fullScreen: false,
  toggleFullScreen: () => {},
  currSegment: { showModal: false },
  currChildChunk: { showModal: false },
})

export const useSegmentListContext = (selector: (value: SegmentListContextValue) => any) => {
  return useContextSelector(SegmentListContext, selector)
}

interface ICompletedProps {
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
  const pathname = usePathname()
  const datasetId = useDocumentContext(s => s.datasetId) || ''
  const documentId = useDocumentContext(s => s.documentId) || ''
  const docForm = useDocumentContext(s => s.docForm)
  const mode = useDocumentContext(s => s.mode)
  const parentMode = useDocumentContext(s => s.parentMode)
  // the current segment id and whether to show the modal
  const [currSegment, setCurrSegment] = useState<CurrSegmentType>({ showModal: false })
  const [currChildChunk, setCurrChildChunk] = useState<CurrChildChunkType>({ showModal: false })
  const [currChunkId, setCurrChunkId] = useState('')

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
  const [showNewChildSegmentModal, setShowNewChildSegmentModal] = useState(false)

  const segmentListRef = useRef<HTMLDivElement>(null)
  const childSegmentListRef = useRef<HTMLDivElement>(null)
  const needScrollToBottom = useRef(false)
  const statusList = useRef<Item[]>([
    { value: 'all', name: t('datasetDocuments.list.index.all') },
    { value: 0, name: t('datasetDocuments.list.status.disabled') },
    { value: 1, name: t('datasetDocuments.list.status.enabled') },
  ])

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchValue(inputValue)
    setCurrentPage(1)
  }, { wait: 500 })

  const handleInputChange = (value: string) => {
    setInputValue(value)
    handleSearch()
  }

  const onChangeStatus = ({ value }: Item) => {
    setSelectedStatus(value === 'all' ? 'all' : !!value)
    setCurrentPage(1)
  }

  const isFullDocMode = useMemo(() => {
    return mode === 'hierarchical' && parentMode === 'full-doc'
  }, [mode, parentMode])

  const { isFetching: isLoadingSegmentList, data: segmentListData } = useSegmentList(
    {
      datasetId,
      documentId,
      params: {
        page: isFullDocMode ? 1 : currentPage,
        limit: isFullDocMode ? 10 : limit,
        keyword: isFullDocMode ? '' : searchValue,
        enabled: selectedStatus,
      },
    },
  )
  const invalidSegmentList = useInvalid(useSegmentListKey)

  useEffect(() => {
    if (segmentListData) {
      setSegments(segmentListData.data || [])
      const totalPages = segmentListData.total_pages
      if (totalPages < currentPage)
        setCurrentPage(totalPages === 0 ? 1 : totalPages)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentListData])

  useEffect(() => {
    if (segmentListRef.current && needScrollToBottom.current) {
      segmentListRef.current.scrollTo({ top: segmentListRef.current.scrollHeight, behavior: 'smooth' })
      needScrollToBottom.current = false
    }
  }, [segments])

  const { isFetching: isLoadingChildSegmentList, data: childChunkListData } = useChildSegmentList(
    {
      datasetId,
      documentId,
      segmentId: segments[0]?.id || '',
      params: {
        page: currentPage === 0 ? 1 : currentPage,
        limit,
        keyword: searchValue,
      },
    },
    !isFullDocMode || segments.length === 0,
  )
  const invalidChildSegmentList = useInvalid(useChildSegmentListKey)

  useEffect(() => {
    if (childSegmentListRef.current && needScrollToBottom.current) {
      childSegmentListRef.current.scrollTo({ top: childSegmentListRef.current.scrollHeight, behavior: 'smooth' })
      needScrollToBottom.current = false
    }
  }, [childSegments])

  useEffect(() => {
    if (childChunkListData) {
      setChildSegments(childChunkListData.data || [])
      const totalPages = childChunkListData.total_pages
      if (totalPages < currentPage)
        setCurrentPage(totalPages === 0 ? 1 : totalPages)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childChunkListData])

  const resetList = useCallback(() => {
    setSelectedSegmentIds([])
    invalidSegmentList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetChildList = useCallback(() => {
    invalidChildSegmentList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onClickCard = (detail: SegmentDetailModel, isEditMode = false) => {
    setCurrSegment({ segInfo: detail, showModal: true, isEditMode })
  }

  const onCloseSegmentDetail = useCallback(() => {
    setCurrSegment({ showModal: false })
    setFullScreen(false)
  }, [])

  const onCloseNewSegmentModal = useCallback(() => {
    onNewSegmentModalChange(false)
    setFullScreen(false)
  }, [onNewSegmentModalChange])

  const onCloseNewChildChunkModal = useCallback(() => {
    setShowNewChildSegmentModal(false)
    setFullScreen(false)
  }, [])

  const { mutateAsync: enableSegment } = useEnableSegment()
  const { mutateAsync: disableSegment } = useDisableSegment()
  const invalidChunkListAll = useInvalid(useChunkListAllKey)
  const invalidChunkListEnabled = useInvalid(useChunkListEnabledKey)
  const invalidChunkListDisabled = useInvalid(useChunkListDisabledKey)

  const refreshChunkListWithStatusChanged = () => {
    switch (selectedStatus) {
      case 'all':
        invalidChunkListDisabled()
        invalidChunkListEnabled()
        break
      default:
        invalidSegmentList()
    }
  }

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
        refreshChunkListWithStatusChanged()
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

  const { mutateAsync: updateSegment } = useUpdateSegment()

  const refreshChunkListDataWithDetailChanged = () => {
    switch (selectedStatus) {
      case 'all':
        invalidChunkListDisabled()
        invalidChunkListEnabled()
        break
      case true:
        invalidChunkListAll()
        invalidChunkListDisabled()
        break
      case false:
        invalidChunkListAll()
        invalidChunkListEnabled()
        break
    }
  }

  const handleUpdateSegment = useCallback(async (
    segmentId: string,
    question: string,
    answer: string,
    keywords: string[],
    needRegenerate = false,
  ) => {
    const params: SegmentUpdater = { content: '' }
    if (docForm === ChunkingMode.qa) {
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

    eventEmitter?.emit('update-segment')
    await updateSegment({ datasetId, documentId, segmentId, body: params }, {
      onSuccess(res) {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        if (!needRegenerate)
          onCloseSegmentDetail()
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
        refreshChunkListDataWithDetailChanged()
        eventEmitter?.emit('update-segment-success')
      },
      onSettled() {
        eventEmitter?.emit('update-segment-done')
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, datasetId, documentId])

  useEffect(() => {
    resetList()
  }, [pathname])

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
    const isSearch = searchValue !== '' || selectedStatus !== 'all'
    if (!isSearch) {
      const total = segmentListData?.total ? formatNumber(segmentListData.total) : '--'
      const count = total === '--' ? 0 : segmentListData!.total
      const translationKey = (mode === 'hierarchical' && parentMode === 'paragraph')
        ? 'datasetDocuments.segment.parentChunks'
        : 'datasetDocuments.segment.chunks'
      return `${total} ${t(translationKey, { count })}`
    }
    else {
      const total = typeof segmentListData?.total === 'number' ? formatNumber(segmentListData.total) : 0
      const count = segmentListData?.total || 0
      return `${total} ${t('datasetDocuments.segment.searchResults', { count })}`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentListData?.total, mode, parentMode, searchValue, selectedStatus])

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

  const { mutateAsync: deleteChildSegment } = useDeleteChildSegment()

  const onDeleteChildChunk = useCallback(async (segmentId: string, childChunkId: string) => {
    await deleteChildSegment(
      { datasetId, documentId, segmentId, childChunkId },
      {
        onSuccess: () => {
          notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
          if (parentMode === 'paragraph')
            resetList()
          else
            resetChildList()
        },
        onError: () => {
          notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
        },
      },
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, documentId, parentMode])

  const handleAddNewChildChunk = useCallback((parentChunkId: string) => {
    setShowNewChildSegmentModal(true)
    setCurrChunkId(parentChunkId)
  }, [])

  const onSaveNewChildChunk = useCallback((newChildChunk?: ChildChunkDetail) => {
    if (parentMode === 'paragraph') {
      for (const seg of segments) {
        if (seg.id === currChunkId)
          seg.child_chunks?.push(newChildChunk!)
      }
      setSegments([...segments])
      refreshChunkListDataWithDetailChanged()
    }
    else {
      resetChildList()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentMode, currChunkId, segments])

  const viewNewlyAddedChildChunk = useCallback(() => {
    const totalPages = childChunkListData?.total_pages || 0
    const total = childChunkListData?.total || 0
    const newPage = Math.ceil((total + 1) / limit)
    needScrollToBottom.current = true
    if (newPage > totalPages) {
      setCurrentPage(totalPages + 1)
    }
    else {
      resetChildList()
      currentPage !== totalPages && setCurrentPage(totalPages)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childChunkListData, limit, currentPage])

  const onClickSlice = useCallback((detail: ChildChunkDetail) => {
    setCurrChildChunk({ childChunkInfo: detail, showModal: true })
    setCurrChunkId(detail.segment_id)
  }, [])

  const onCloseChildSegmentDetail = useCallback(() => {
    setCurrChildChunk({ showModal: false })
    setFullScreen(false)
  }, [])

  const { mutateAsync: updateChildSegment } = useUpdateChildSegment()

  const handleUpdateChildChunk = useCallback(async (
    segmentId: string,
    childChunkId: string,
    content: string,
  ) => {
    const params: SegmentUpdater = { content: '' }
    if (!content.trim())
      return notify({ type: 'error', message: t('datasetDocuments.segment.contentEmpty') })

    params.content = content

    eventEmitter?.emit('update-child-segment')
    await updateChildSegment({ datasetId, documentId, segmentId, childChunkId, body: params }, {
      onSuccess: (res) => {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        onCloseChildSegmentDetail()
        if (parentMode === 'paragraph') {
          for (const seg of segments) {
            if (seg.id === segmentId) {
              for (const childSeg of seg.child_chunks!) {
                if (childSeg.id === childChunkId) {
                  childSeg.content = res.data.content
                  childSeg.type = res.data.type
                  childSeg.word_count = res.data.word_count
                  childSeg.updated_at = res.data.updated_at
                }
              }
            }
          }
          setSegments([...segments])
          refreshChunkListDataWithDetailChanged()
        }
        else {
          resetChildList()
        }
      },
      onSettled: () => {
        eventEmitter?.emit('update-child-segment-done')
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, childSegments, datasetId, documentId, parentMode])

  const onClearFilter = useCallback(() => {
    setInputValue('')
    setSearchValue('')
    setSelectedStatus('all')
    setCurrentPage(1)
  }, [])

  return (
    <SegmentListContext.Provider value={{
      isCollapsed,
      fullScreen,
      toggleFullScreen,
      currSegment,
      currChildChunk,
    }}>
      {/* Menu Bar */}
      {!isFullDocMode && <div className={s.docSearchWrapper}>
        <Checkbox
          className='shrink-0'
          checked={isAllSelected}
          mixed={!isAllSelected && isSomeSelected}
          onCheck={onSelectedAll}
          disabled={isLoadingSegmentList}
        />
        <div className={'system-sm-semibold-uppercase text-text-secondary flex-1 pl-5'}>{totalText}</div>
        <SimpleSelect
          onSelect={onChangeStatus}
          items={statusList.current}
          defaultValue={selectedStatus === 'all' ? 'all' : selectedStatus ? 1 : 0}
          className={s.select}
          wrapperClassName='h-fit mr-2'
          optionWrapClassName='w-[160px]'
          optionClassName='p-0'
          renderOption={({ item, selected }) => <StatusItem item={item} selected={selected} />}
          notClearable
        />
        <Input
          showLeftIcon
          showClearIcon
          wrapperClassName='!w-52'
          value={inputValue}
          onChange={e => handleInputChange(e.target.value)}
          onClear={() => handleInputChange('')}
        />
        <Divider type='vertical' className='mx-3 h-3.5' />
        <DisplayToggle isCollapsed={isCollapsed} toggleCollapsed={() => setIsCollapsed(!isCollapsed)} />
      </div>}
      {/* Segment list */}
      {
        isFullDocMode
          ? <div className={cn(
            'flex grow flex-col overflow-x-hidden',
            (isLoadingSegmentList || isLoadingChildSegmentList) ? 'overflow-y-hidden' : 'overflow-y-auto',
          )}>
            <SegmentCard
              detail={segments[0]}
              onClick={() => onClickCard(segments[0])}
              loading={isLoadingSegmentList}
              focused={{
                segmentIndex: currSegment?.segInfo?.id === segments[0]?.id,
                segmentContent: currSegment?.segInfo?.id === segments[0]?.id,
              }}
            />
            <ChildSegmentList
              parentChunkId={segments[0]?.id}
              onDelete={onDeleteChildChunk}
              childChunks={childSegments}
              handleInputChange={handleInputChange}
              handleAddNewChildChunk={handleAddNewChildChunk}
              onClickSlice={onClickSlice}
              enabled={!archived}
              total={childChunkListData?.total || 0}
              inputValue={inputValue}
              onClearFilter={onClearFilter}
              isLoading={isLoadingSegmentList || isLoadingChildSegmentList}
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
            onDeleteChildChunk={onDeleteChildChunk}
            handleAddNewChildChunk={handleAddNewChildChunk}
            onClickSlice={onClickSlice}
            onClearFilter={onClearFilter}
          />
      }
      {/* Pagination */}
      <Divider type='horizontal' className='bg-divider-subtle mx-6 my-0 h-[1px] w-auto' />
      <Pagination
        current={currentPage - 1}
        onChange={cur => setCurrentPage(cur + 1)}
        total={(isFullDocMode ? childChunkListData?.total : segmentListData?.total) || 0}
        limit={limit}
        onLimitChange={limit => setLimit(limit)}
        className={isFullDocMode ? 'px-3' : ''}
      />
      {/* Edit or view segment detail */}
      <FullScreenDrawer
        isOpen={currSegment.showModal}
        fullScreen={fullScreen}
        onClose={onCloseSegmentDetail}
      >
        <SegmentDetail
          segInfo={currSegment.segInfo ?? { id: '' }}
          docForm={docForm}
          isEditMode={currSegment.isEditMode}
          onUpdate={handleUpdateSegment}
          onCancel={onCloseSegmentDetail}
        />
      </FullScreenDrawer>
      {/* Create New Segment */}
      <FullScreenDrawer
        isOpen={showNewSegmentModal}
        fullScreen={fullScreen}
        onClose={onCloseNewSegmentModal}
      >
        <NewSegment
          docForm={docForm}
          onCancel={onCloseNewSegmentModal}
          onSave={resetList}
          viewNewlyAddedChunk={viewNewlyAddedChunk}
        />
      </FullScreenDrawer>
      {/* Edit or view child segment detail */}
      <FullScreenDrawer
        isOpen={currChildChunk.showModal}
        fullScreen={fullScreen}
        onClose={onCloseChildSegmentDetail}
      >
        <ChildSegmentDetail
          chunkId={currChunkId}
          childChunkInfo={currChildChunk.childChunkInfo ?? { id: '' }}
          docForm={docForm}
          onUpdate={handleUpdateChildChunk}
          onCancel={onCloseChildSegmentDetail}
        />
      </FullScreenDrawer>
      {/* Create New Child Segment */}
      <FullScreenDrawer
        isOpen={showNewChildSegmentModal}
        fullScreen={fullScreen}
        onClose={onCloseNewChildChunkModal}
      >
        <NewChildSegment
          chunkId={currChunkId}
          onCancel={onCloseNewChildChunkModal}
          onSave={onSaveNewChildChunk}
          viewNewlyAddedChildChunk={viewNewlyAddedChildChunk}
        />
      </FullScreenDrawer>
      {/* Batch Action Buttons */}
      {selectedSegmentIds.length > 0
        && <BatchAction
          className='absolute bottom-16 left-0 z-20'
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
