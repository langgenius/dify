import React, { type FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiCollapseDiagonalLine,
  RiExpandDiagonalLine,
} from '@remixicon/react'
import { useDocumentContext } from '../context'
import ActionButtons from './common/action-buttons'
import ChunkContent from './common/chunk-content'
import Keywords from './common/keywords'
import RegenerationModal from './common/regeneration-modal'
import { SegmentIndexTag } from './common/segment-index-tag'
import Dot from './common/dot'
import { useSegmentListContext } from './index'
import { ChunkingMode, type SegmentDetailModel } from '@/models/datasets'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { formatNumber } from '@/utils/format'
import cn from '@/utils/classnames'
import Divider from '@/app/components/base/divider'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { IndexingType } from '../../../create/step-two'

type ISegmentDetailProps = {
  segInfo?: Partial<SegmentDetailModel> & { id: string }
  onUpdate: (segmentId: string, q: string, a: string, k: string[], needRegenerate?: boolean) => void
  onCancel: () => void
  isEditMode?: boolean
  docForm: ChunkingMode
}

/**
 * Show all the contents of the segment
 */
const SegmentDetail: FC<ISegmentDetailProps> = ({
  segInfo,
  onUpdate,
  onCancel,
  isEditMode,
  docForm,
}) => {
  const { t } = useTranslation()
  const [question, setQuestion] = useState(isEditMode ? segInfo?.content || '' : segInfo?.sign_content || '')
  const [answer, setAnswer] = useState(segInfo?.answer || '')
  const [keywords, setKeywords] = useState<string[]>(segInfo?.keywords || [])
  const { eventEmitter } = useEventEmitterContextContext()
  const [loading, setLoading] = useState(false)
  const [showRegenerationModal, setShowRegenerationModal] = useState(false)
  const fullScreen = useSegmentListContext(s => s.fullScreen)
  const toggleFullScreen = useSegmentListContext(s => s.toggleFullScreen)
  const parentMode = useDocumentContext(s => s.parentMode)
  const indexingTechnique = useDatasetDetailContextWithSelector(s => s.dataset?.indexing_technique)

  eventEmitter?.useSubscription((v) => {
    if (v === 'update-segment')
      setLoading(true)
    if (v === 'update-segment-done')
      setLoading(false)
  })

  const handleCancel = useCallback(() => {
    onCancel()
  }, [onCancel])

  const handleSave = useCallback(() => {
    onUpdate(segInfo?.id || '', question, answer, keywords)
  }, [onUpdate, segInfo?.id, question, answer, keywords])

  const handleRegeneration = useCallback(() => {
    setShowRegenerationModal(true)
  }, [])

  const onCancelRegeneration = useCallback(() => {
    setShowRegenerationModal(false)
  }, [])

  const onConfirmRegeneration = useCallback(() => {
    onUpdate(segInfo?.id || '', question, answer, keywords, true)
  }, [onUpdate, segInfo?.id, question, answer, keywords])

  const wordCountText = useMemo(() => {
    const contentLength = docForm === ChunkingMode.qa ? (question.length + answer.length) : question.length
    const total = formatNumber(isEditMode ? contentLength : segInfo!.word_count as number)
    const count = isEditMode ? contentLength : segInfo!.word_count as number
    return `${total} ${t('datasetDocuments.segment.characters', { count })}`
  }, [isEditMode, question.length, answer.length, docForm, segInfo, t])

  const isFullDocMode = docForm === ChunkingMode.parentChild && parentMode === 'full-doc'
  const titleText = isEditMode ? t('datasetDocuments.segment.editChunk') : t('datasetDocuments.segment.chunkDetail')
  const labelPrefix = docForm === ChunkingMode.parentChild ? t('datasetDocuments.segment.parentChunk') : t('datasetDocuments.segment.chunk')
  const isECOIndexing = indexingTechnique === IndexingType.ECONOMICAL

  return (
    <div className={'flex h-full flex-col'}>
      <div className={cn('flex items-center justify-between', fullScreen ? 'border border-divider-subtle py-3 pl-6 pr-4' : 'pl-4 pr-3 pt-3')}>
        <div className='flex flex-col'>
          <div className='system-xl-semibold text-text-primary'>{titleText}</div>
          <div className='flex items-center gap-x-2'>
            <SegmentIndexTag positionId={segInfo?.position || ''} label={isFullDocMode ? labelPrefix : ''} labelPrefix={labelPrefix} />
            <Dot />
            <span className='system-xs-medium text-text-tertiary'>{wordCountText}</span>
          </div>
        </div>
        <div className='flex items-center'>
          {isEditMode && fullScreen && (
            <>
              <ActionButtons
                handleCancel={handleCancel}
                handleRegeneration={handleRegeneration}
                handleSave={handleSave}
                loading={loading}
              />
              <Divider type='vertical' className='ml-4 mr-2 h-3.5 bg-divider-regular' />
            </>
          )}
          <div className='mr-1 flex h-8 w-8 cursor-pointer items-center justify-center p-1.5' onClick={toggleFullScreen}>
            {fullScreen ? <RiCollapseDiagonalLine className='h-4 w-4 text-text-tertiary' /> : <RiExpandDiagonalLine className='h-4 w-4 text-text-tertiary' />}
          </div>
          <div className='flex h-8 w-8 cursor-pointer items-center justify-center p-1.5' onClick={onCancel}>
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className={cn(
        'flex grow',
        fullScreen ? 'w-full flex-row justify-center gap-x-8 px-6 pt-6' : 'flex-col gap-y-1 px-4 py-3',
        !isEditMode && 'overflow-hidden pb-0',
      )}>
        <div className={cn(isEditMode ? 'overflow-hidden whitespace-pre-line break-all' : 'overflow-y-auto', fullScreen ? 'w-1/2' : 'grow')}>
          <ChunkContent
            docForm={docForm}
            question={question}
            answer={answer}
            onQuestionChange={question => setQuestion(question)}
            onAnswerChange={answer => setAnswer(answer)}
            isEditMode={isEditMode}
          />
        </div>
        {isECOIndexing && <Keywords
          className={fullScreen ? 'w-1/5' : ''}
          actionType={isEditMode ? 'edit' : 'view'}
          segInfo={segInfo}
          keywords={keywords}
          isEditMode={isEditMode}
          onKeywordsChange={keywords => setKeywords(keywords)}
        />}
      </div>
      {isEditMode && !fullScreen && (
        <div className='flex items-center justify-end border-t-[1px] border-t-divider-subtle p-4 pt-3'>
          <ActionButtons
            handleCancel={handleCancel}
            handleRegeneration={handleRegeneration}
            handleSave={handleSave}
            loading={loading}
          />
        </div>
      )}
      {
        showRegenerationModal && (
          <RegenerationModal
            isShow={showRegenerationModal}
            onConfirm={onConfirmRegeneration}
            onCancel={onCancelRegeneration}
            onClose={onCancelRegeneration}
          />
        )
      }
    </div>
  )
}

export default React.memo(SegmentDetail)
