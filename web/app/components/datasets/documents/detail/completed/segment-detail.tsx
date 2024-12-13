import React, { type FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiExpandDiagonalLine,
} from '@remixicon/react'
import { useDocumentContext } from '../index'
import ActionButtons from './common/action-buttons'
import ChunkContent from './common/chunk-content'
import Keywords from './common/keywords'
import RegenerationModal from './common/regeneration-modal'
import { SegmentIndexTag } from './common/segment-index-tag'
import Dot from './common/dot'
import { useSegmentListContext } from './index'
import type { SegmentDetailModel } from '@/models/datasets'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { formatNumber } from '@/utils/format'
import classNames from '@/utils/classnames'
import Divider from '@/app/components/base/divider'

type ISegmentDetailProps = {
  segInfo?: Partial<SegmentDetailModel> & { id: string }
  onUpdate: (segmentId: string, q: string, a: string, k: string[], needRegenerate?: boolean) => void
  onCancel: () => void
  isEditMode?: boolean
  docForm: string
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
  const [question, setQuestion] = useState(segInfo?.content || '')
  const [answer, setAnswer] = useState(segInfo?.answer || '')
  const [keywords, setKeywords] = useState<string[]>(segInfo?.keywords || [])
  const { eventEmitter } = useEventEmitterContextContext()
  const [loading, setLoading] = useState(false)
  const [showRegenerationModal, setShowRegenerationModal] = useState(false)
  const [fullScreen, toggleFullScreen] = useSegmentListContext(s => [s.fullScreen, s.toggleFullScreen])
  const mode = useDocumentContext(s => s.mode)

  eventEmitter?.useSubscription((v) => {
    if (v === 'update-segment')
      setLoading(true)
    if (v === 'update-segment-done')
      setLoading(false)
  })

  const handleCancel = () => {
    onCancel()
    setQuestion(segInfo?.content || '')
    setAnswer(segInfo?.answer || '')
    setKeywords(segInfo?.keywords || [])
  }

  const handleSave = () => {
    onUpdate(segInfo?.id || '', question, answer, keywords)
  }

  const handleRegeneration = () => {
    setShowRegenerationModal(true)
  }

  const onCancelRegeneration = () => {
    setShowRegenerationModal(false)
  }

  const onConfirmRegeneration = () => {
    onUpdate(segInfo?.id || '', question, answer, keywords, true)
  }

  const isParentChildMode = useMemo(() => {
    return mode === 'hierarchical'
  }, [mode])

  const titleText = useMemo(() => {
    return isEditMode ? t('datasetDocuments.segment.editChunk') : t('datasetDocuments.segment.chunkDetail')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode])

  const wordCountText = useMemo(() => {
    const total = formatNumber(isEditMode ? question.length : segInfo!.word_count as number)
    const count = isEditMode ? question.length : segInfo!.word_count as number
    return `${total} ${t('datasetDocuments.segment.characters', { count })}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, question.length, segInfo?.word_count])

  const labelPrefix = useMemo(() => {
    return isParentChildMode ? t('datasetDocuments.segment.parentChunk') : t('datasetDocuments.segment.chunk')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParentChildMode])

  return (
    <div className={'flex flex-col h-full'}>
      <div className={classNames('flex items-center justify-between', fullScreen ? 'py-3 pr-4 pl-6 border border-divider-subtle' : 'pt-3 pr-3 pl-4')}>
        <div className='flex flex-col'>
          <div className='text-text-primary system-xl-semibold'>{titleText}</div>
          <div className='flex items-center gap-x-2'>
            <SegmentIndexTag positionId={segInfo?.position || ''} labelPrefix={labelPrefix} />
            <Dot />
            <span className='text-text-tertiary system-xs-medium'>{wordCountText}</span>
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
              <Divider type='vertical' className='h-3.5 bg-divider-regular ml-4 mr-2' />
            </>
          )}
          <div className='w-8 h-8 flex justify-center items-center p-1.5 cursor-pointer mr-1' onClick={toggleFullScreen}>
            <RiExpandDiagonalLine className='w-4 h-4 text-text-tertiary' />
          </div>
          <div className='w-8 h-8 flex justify-center items-center p-1.5 cursor-pointer' onClick={onCancel}>
            <RiCloseLine className='w-4 h-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className={classNames('flex grow overflow-hidden', fullScreen ? 'w-full flex-row justify-center px-6 pt-6 gap-x-8 mx-auto' : 'flex-col gap-y-1 py-3 px-4')}>
        <div className={classNames('break-all overflow-y-auto whitespace-pre-line', fullScreen ? 'w-1/2' : 'grow')}>
          <ChunkContent
            docForm={docForm}
            question={question}
            answer={answer}
            onQuestionChange={question => setQuestion(question)}
            onAnswerChange={answer => setAnswer(answer)}
            isEditMode={isEditMode}
          />
        </div>
        {mode === 'custom' && <Keywords
          className={fullScreen ? 'w-1/5' : ''}
          actionType={isEditMode ? 'edit' : 'view'}
          segInfo={segInfo}
          keywords={keywords}
          isEditMode={isEditMode}
          onKeywordsChange={keywords => setKeywords(keywords)}
        />}
      </div>
      {isEditMode && !fullScreen && (
        <div className='flex items-center justify-end p-4 pt-3 border-t-[1px] border-t-divider-subtle'>
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
