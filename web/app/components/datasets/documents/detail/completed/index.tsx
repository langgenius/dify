'use client'
import type { FC } from 'react'
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useDebounceFn } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import {
  RiCloseLine,
  RiEditLine,
} from '@remixicon/react'
import { StatusItem } from '../../list'
import { DocumentContext } from '../index'
import { ProcessStatus } from '../segment-add'
import s from './style.module.css'
import SegmentList from './segment-list'
import DisplayToggle from './display-toggle'
import BatchAction from './batch-action'
import cn from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import Modal from '@/app/components/base/modal'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { ToastContext } from '@/app/components/base/toast'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect } from '@/app/components/base/select'
import { updateSegment } from '@/service/datasets'
import type { ParentMode, ProcessMode, SegmentDetailModel, SegmentUpdater } from '@/models/datasets'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea/common'
import Button from '@/app/components/base/button'
import NewSegmentModal from '@/app/components/datasets/documents/detail/new-segment-modal'
import TagInput from '@/app/components/base/tag-input'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import Checkbox from '@/app/components/base/checkbox'
import { useDeleteSegment, useDisableSegment, useEnableSegment, useSegmentList } from '@/service/knowledge/use-segment'
import { Chunk } from '@/app/components/base/icons/src/public/knowledge'

type SegmentListContextValue = {
  isCollapsed: boolean
  toggleCollapsed: () => void
}

const SegmentListContext = createContext({
  isCollapsed: true,
  toggleCollapsed: () => {},
})

export const useSegmentListContext = (selector: (value: SegmentListContextValue) => any) => {
  return useContextSelector(SegmentListContext, selector)
}

export const SegmentIndexTag: FC<{ positionId: string | number; className?: string }> = ({ positionId, className }) => {
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
        {localPositionId}
      </div>
    </div>
  )
}

type ISegmentDetailProps = {
  embeddingAvailable: boolean
  segInfo?: Partial<SegmentDetailModel> & { id: string }
  onChangeSwitch?: (enabled: boolean, segId?: string) => Promise<void>
  onUpdate: (segmentId: string, q: string, a: string, k: string[]) => void
  onCancel: () => void
  archived?: boolean
  isEditing?: boolean
}
/**
 * Show all the contents of the segment
 */
const SegmentDetailComponent: FC<ISegmentDetailProps> = ({
  embeddingAvailable,
  segInfo,
  archived,
  onChangeSwitch,
  onUpdate,
  onCancel,
  isEditing: initialIsEditing,
}) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(initialIsEditing)
  const [question, setQuestion] = useState(segInfo?.content || '')
  const [answer, setAnswer] = useState(segInfo?.answer || '')
  const [keywords, setKeywords] = useState<string[]>(segInfo?.keywords || [])
  const { eventEmitter } = useEventEmitterContextContext()
  const [loading, setLoading] = useState(false)

  eventEmitter?.useSubscription((v) => {
    if (v === 'update-segment')
      setLoading(true)
    else
      setLoading(false)
  })

  const handleCancel = () => {
    setIsEditing(false)
    setQuestion(segInfo?.content || '')
    setAnswer(segInfo?.answer || '')
    setKeywords(segInfo?.keywords || [])
  }
  const handleSave = () => {
    onUpdate(segInfo?.id || '', question, answer, keywords)
  }

  const renderContent = () => {
    if (segInfo?.answer) {
      return (
        <>
          <div className='mb-1 text-xs font-medium text-gray-500'>QUESTION</div>
          <AutoHeightTextarea
            outerClassName='mb-4'
            className='leading-6 text-md text-gray-800'
            value={question}
            placeholder={t('datasetDocuments.segment.questionPlaceholder') || ''}
            onChange={e => setQuestion(e.target.value)}
            disabled={!isEditing}
          />
          <div className='mb-1 text-xs font-medium text-gray-500'>ANSWER</div>
          <AutoHeightTextarea
            outerClassName='mb-4'
            className='leading-6 text-md text-gray-800'
            value={answer}
            placeholder={t('datasetDocuments.segment.answerPlaceholder') || ''}
            onChange={e => setAnswer(e.target.value)}
            disabled={!isEditing}
            autoFocus
          />
        </>
      )
    }

    return (
      <AutoHeightTextarea
        className='leading-6 text-md text-gray-800'
        value={question}
        placeholder={t('datasetDocuments.segment.contentPlaceholder') || ''}
        onChange={e => setQuestion(e.target.value)}
        disabled={!isEditing}
        autoFocus
      />
    )
  }

  return (
    <div className={'flex flex-col relative'}>
      <div className='absolute right-0 top-0 flex items-center h-7'>
        {isEditing && (
          <>
            <Button
              onClick={handleCancel}>
              {t('common.operation.cancel')}
            </Button>
            <Button
              variant='primary'
              className='ml-3'
              onClick={handleSave}
              disabled={loading}
            >
              {t('common.operation.save')}
            </Button>
          </>
        )}
        {!isEditing && !archived && embeddingAvailable && (
          <>
            <div className='group relative flex justify-center items-center w-6 h-6 hover:bg-gray-100 rounded-md cursor-pointer'>
              <div className={cn(s.editTip, 'hidden items-center absolute -top-10 px-3 h-[34px] bg-white rounded-lg whitespace-nowrap text-xs font-semibold text-gray-700 group-hover:flex')}>{t('common.operation.edit')}</div>
              <RiEditLine className='w-4 h-4 text-gray-500' onClick={() => setIsEditing(true)} />
            </div>
            <div className='mx-3 w-[1px] h-3 bg-gray-200' />
          </>
        )}
        <div className='flex justify-center items-center w-6 h-6 cursor-pointer' onClick={onCancel}>
          <RiCloseLine className='w-4 h-4 text-gray-500' />
        </div>
      </div>
      <SegmentIndexTag positionId={segInfo?.position || ''} className='w-fit mt-[2px] mb-6' />
      <div className={s.segModalContent}>{renderContent()}</div>
      <div className={s.keywordTitle}>{t('datasetDocuments.segment.keywords')}</div>
      <div className={s.keywordWrapper}>
        {!segInfo?.keywords?.length
          ? '-'
          : (
            <TagInput
              items={keywords}
              onChange={newKeywords => setKeywords(newKeywords)}
              disableAdd={!isEditing}
              disableRemove={!isEditing || (keywords.length === 1)}
            />
          )
        }
      </div>
      <div className={cn(s.footer, s.numberInfo)}>
        <div className='flex items-center flex-wrap gap-y-2'>
          <div className={cn(s.commonIcon, s.typeSquareIcon)} /><span className='mr-8'>{formatNumber(segInfo?.word_count as number)} {t('datasetDocuments.segment.characters')}</span>
          <div className={cn(s.commonIcon, s.targetIcon)} /><span className='mr-8'>{formatNumber(segInfo?.hit_count as number)} {t('datasetDocuments.segment.hitCount')}</span>
          <div className={cn(s.commonIcon, s.bezierCurveIcon)} /><span className={s.hashText}>{t('datasetDocuments.segment.vectorHash')}{segInfo?.index_node_hash}</span>
        </div>
        <div className='flex items-center'>
          <StatusItem status={segInfo?.enabled ? 'enabled' : 'disabled'} reverse textCls='text-gray-500 text-xs' />
          {embeddingAvailable && (
            <>
              <Divider type='vertical' className='!h-2' />
              <Switch
                size='md'
                defaultValue={segInfo?.enabled}
                onChange={async (val) => {
                  await onChangeSwitch?.(val, segInfo?.id || '')
                }}
                disabled={archived}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
export const SegmentDetail = memo(SegmentDetailComponent)

export const splitArray = (arr: any[], size = 3) => {
  if (!arr || !arr.length)
    return []
  const result = []
  for (let i = 0; i < arr.length; i += size)
    result.push(arr.slice(i, i + size))
  return result
}

type ICompletedProps = {
  embeddingAvailable: boolean
  showNewSegmentModal: boolean
  onNewSegmentModalChange: (state: boolean) => void
  importStatus: ProcessStatus | string | undefined
  archived?: boolean
  mode?: ProcessMode
  parentMode?: ParentMode
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
  mode,
  parentMode,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { datasetId = '', documentId = '', docForm } = useContext(DocumentContext)
  // the current segment id and whether to show the modal
  const [currSegment, setCurrSegment] = useState<{ segInfo?: SegmentDetailModel; showModal: boolean; isEditing?: boolean }>({ showModal: false })

  const [inputValue, setInputValue] = useState<string>('') // the input value
  const [searchValue, setSearchValue] = useState<string>('') // the search value
  const [selectedStatus, setSelectedStatus] = useState<boolean | 'all'>('all') // the selected status, enabled/disabled/undefined

  const [segments, setSegments] = useState<SegmentDetailModel[]>([]) // all segments data
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([])
  const { eventEmitter } = useEventEmitterContextContext()
  const [isCollapsed, setIsCollapsed] = useState(true)
  // todo: pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [limit, setLimit] = useState(10)

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

  const { isLoading: isLoadingSegmentList, data: segmentList, refetch: refreshSegmentList } = useSegmentList(
    {
      datasetId,
      documentId,
      params: {
        page: currentPage,
        limit,
        keyword: searchValue,
        enabled: selectedStatus === 'all' ? 'all' : !!selectedStatus,
      },
    },
    mode === 'hierarchical' && parentMode === 'full-doc',
  )

  useEffect(() => {
    if (segmentList)
      setSegments(segmentList.data || [])
  }, [segmentList])

  const resetList = useCallback(() => {
    setSegments([])
    refreshSegmentList()
  }, [])

  const onClickCard = (detail: SegmentDetailModel, isEditing = false) => {
    setCurrSegment({ segInfo: detail, showModal: true, isEditing })
  }

  const onCloseModal = () => {
    setCurrSegment({ ...currSegment, showModal: false })
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
      onCloseModal()
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
    return segments.every(seg => selectedSegmentIds.includes(seg.id))
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
    return segmentList?.total ? formatNumber(segmentList.total) : '--'
  }, [segmentList?.total])

  return (
    <SegmentListContext.Provider value={{
      isCollapsed,
      toggleCollapsed: () => setIsCollapsed(!isCollapsed),
    }}>
      <div className={s.docSearchWrapper}>
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
      </div>
      <SegmentList
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
      <Modal isShow={currSegment.showModal} onClose={() => { }} className='!max-w-[640px] !overflow-visible'>
        <SegmentDetail
          embeddingAvailable={embeddingAvailable}
          segInfo={currSegment.segInfo ?? { id: '' }}
          isEditing={currSegment.isEditing}
          onChangeSwitch={onChangeSwitch}
          onUpdate={handleUpdateSegment}
          onCancel={onCloseModal}
          archived={archived}
        />
      </Modal>
      <NewSegmentModal
        isShow={showNewSegmentModal}
        docForm={docForm}
        onCancel={() => onNewSegmentModalChange(false)}
        onSave={resetList}
      />
      {selectedSegmentIds.length > 0
      && <BatchAction
        selectedSegmentIds={selectedSegmentIds}
        onBatchEnable={onChangeSwitch.bind(null, true)}
        onBatchDisable={onChangeSwitch.bind(null, false)}
        onBatchDelete={onDelete}
        onCancel={onCancelBatchOperation}
      />}
    </SegmentListContext.Provider>
  )
}

export default Completed
