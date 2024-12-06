'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import { mockChildSegments } from './mock-data'
import SegmentCard from './segment-card'
import ChildSegmentList from './child-segment-list'
import cn from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import Drawer from '@/app/components/base/drawer'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { ToastContext } from '@/app/components/base/toast'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect } from '@/app/components/base/select'
import { updateSegment } from '@/service/datasets'
import type { ChildChunkDetail, SegmentDetailModel, SegmentUpdater } from '@/models/datasets'
import NewSegmentModal from '@/app/components/datasets/documents/detail/new-segment-modal'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import Checkbox from '@/app/components/base/checkbox'
import { useChildSegmentList, useDeleteSegment, useDisableSegment, useEnableSegment, useSegmentList } from '@/service/knowledge/use-segment'
import { Chunk } from '@/app/components/base/icons/src/public/knowledge'

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

export const SegmentIndexTag: FC<{ positionId?: string | number; label?: string; className?: string }> = ({ positionId, label, className }) => {
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
}

type ICompletedProps = {
  embeddingAvailable: boolean
  showNewSegmentModal: boolean
  onNewSegmentModalChange: (state: boolean) => void
  importStatus: ProcessStatus | string | undefined
  archived?: boolean
  // data: Array<{}> // all/part segments
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
  // todo: pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [fullScreen, setFullScreen] = useState(false)

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

  const { isLoading: isLoadingSegmentList, data: segmentListData, refetch: refreshSegmentList } = useSegmentList(
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

  useEffect(() => {
    // setSegments(mockSegments.data)
    // todo: remove mock data
    if (segmentListData)
      setSegments(segmentListData.data || [])
  }, [segmentListData])

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
    setChildSegments(mockChildSegments.data)
    // todo: remove mock data
    // if (childChunkListData)
    //   setChildSegments(childChunkListData.data || [])
  }, [childChunkListData])

  const resetList = useCallback(() => {
    setSegments([])
    refreshSegmentList()
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
      },
      onError: () => {
        notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, documentId, selectedSegmentIds])

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

  const handleUpdateSegment = async (segmentId: string, question: string, answer: string, keywords: string[]) => {
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

    try {
      eventEmitter?.emit('update-segment')
      const res = await updateSegment({ datasetId, documentId, segmentId, body: params })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onCloseDrawer()
      for (const seg of segments) {
        if (seg.id === segmentId) {
          seg.answer = res.data.answer
          seg.content = res.data.content
          seg.keywords = res.data.keywords
          seg.word_count = res.data.word_count
          seg.hit_count = res.data.hit_count
          seg.index_node_hash = res.data.index_node_hash
          seg.enabled = res.data.enabled
        }
      }
      setSegments([...segments])
    }
    finally {
      eventEmitter?.emit('')
    }
  }

  useEffect(() => {
    if (importStatus === ProcessStatus.COMPLETED)
      resetList()
  }, [importStatus, resetList])

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
      {/* Edit or view segment detail */}
      <Drawer
        isOpen={currSegment.showModal}
        onClose={() => {}}
        panelClassname={`!p-0 ${fullScreen
          ? '!max-w-full !w-full'
          : 'mt-16 mr-2 mb-2 !max-w-[560px] !w-[560px] border-[0.5px] border-components-panel-border rounded-xl'}`}
        mask={false}
        unmount
        footer={null}
      >
        <SegmentDetail
          segInfo={currSegment.segInfo ?? { id: '' }}
          isEditMode={currSegment.isEditMode}
          onUpdate={handleUpdateSegment}
          onCancel={onCloseDrawer}
        />
      </Drawer>
      {/* Create New Segment */}
      <NewSegmentModal
        isShow={showNewSegmentModal}
        docForm={docForm}
        onCancel={() => onNewSegmentModalChange(false)}
        onSave={resetList}
      />
      {/* Batch Action Buttons */}
      {selectedSegmentIds.length > 0
      && <BatchAction
        className='absolute left-0 bottom-16 z-20'
        selectedIds={selectedSegmentIds}
        onBatchEnable={onChangeSwitch.bind(null, true)}
        onBatchDisable={onChangeSwitch.bind(null, false)}
        onBatchDelete={onDelete}
        onCancel={onCancelBatchOperation}
      />}
    </SegmentListContext.Provider>
  )
}

export default Completed
