import type { FC } from 'react'
import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { SegmentDetailModel } from '@/models/datasets'
import {
  RiCloseLine,
  RiCollapseDiagonalLine,
  RiExpandDiagonalLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import Divider from '@/app/components/base/divider'
import ImageUploaderInChunk from '@/app/components/datasets/common/image-uploader/image-uploader-in-chunk'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { ChunkingMode } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import { useDocumentContext } from '../context'
import ActionButtons from './common/action-buttons'
import ChunkContent from './common/chunk-content'
import Dot from './common/dot'
import Keywords from './common/keywords'
import RegenerationModal from './common/regeneration-modal'
import { SegmentIndexTag } from './common/segment-index-tag'
import SummaryText from './common/summary-text'
import { useSegmentListContext } from './index'

type ISegmentDetailProps = {
  segInfo?: Partial<SegmentDetailModel> & { id: string }
  onUpdate: (
    segmentId: string,
    q: string,
    a: string,
    k: string[],
    attachments: FileEntity[],
    summary?: string,
    needRegenerate?: boolean,
  ) => void
  onCancel: () => void
  isEditMode?: boolean
  docForm: ChunkingMode
  onModalStateChange?: (isOpen: boolean) => void
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
  onModalStateChange,
}) => {
  const { t } = useTranslation()
  const [question, setQuestion] = useState(isEditMode ? segInfo?.content || '' : segInfo?.sign_content || '')
  const [answer, setAnswer] = useState(segInfo?.answer || '')
  const [summary, setSummary] = useState(segInfo?.summary || '')
  const [attachments, setAttachments] = useState<FileEntity[]>(() => {
    return segInfo?.attachments?.map(item => ({
      id: uuid4(),
      name: item.name,
      size: item.size,
      mimeType: item.mime_type,
      extension: item.extension,
      sourceUrl: item.source_url,
      uploadedId: item.id,
      progress: 100,
    })) || []
  })
  const [keywords, setKeywords] = useState<string[]>(segInfo?.keywords || [])
  const { eventEmitter } = useEventEmitterContextContext()
  const [loading, setLoading] = useState(false)
  const [showRegenerationModal, setShowRegenerationModal] = useState(false)
  const fullScreen = useSegmentListContext(s => s.fullScreen)
  const toggleFullScreen = useSegmentListContext(s => s.toggleFullScreen)
  const parentMode = useDocumentContext(s => s.parentMode)
  const indexingTechnique = useDatasetDetailContextWithSelector(s => s.dataset?.indexing_technique)
  const runtimeMode = useDatasetDetailContextWithSelector(s => s.dataset?.runtime_mode)

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
    onUpdate(segInfo?.id || '', question, answer, keywords, attachments, summary, false)
  }, [onUpdate, segInfo?.id, question, answer, keywords, attachments, summary])

  const handleRegeneration = useCallback(() => {
    setShowRegenerationModal(true)
    onModalStateChange?.(true)
  }, [onModalStateChange])

  const onCancelRegeneration = useCallback(() => {
    setShowRegenerationModal(false)
    onModalStateChange?.(false)
  }, [onModalStateChange])

  const onCloseAfterRegeneration = useCallback(() => {
    setShowRegenerationModal(false)
    onModalStateChange?.(false)
    onCancel() // Close the edit drawer
  }, [onCancel, onModalStateChange])

  const onConfirmRegeneration = useCallback(() => {
    onUpdate(segInfo?.id || '', question, answer, keywords, attachments, summary, true)
  }, [onUpdate, segInfo?.id, question, answer, keywords, attachments, summary])

  const onAttachmentsChange = useCallback((attachments: FileEntity[]) => {
    setAttachments(attachments)
  }, [])

  const wordCountText = useMemo(() => {
    const contentLength = docForm === ChunkingMode.qa ? (question.length + answer.length) : question.length
    const total = formatNumber(isEditMode ? contentLength : segInfo!.word_count as number)
    const count = isEditMode ? contentLength : segInfo!.word_count as number
    return `${total} ${t('segment.characters', { ns: 'datasetDocuments', count })}`
  }, [isEditMode, question.length, answer.length, docForm, segInfo, t])

  const isFullDocMode = docForm === ChunkingMode.parentChild && parentMode === 'full-doc'
  const titleText = isEditMode ? t('segment.editChunk', { ns: 'datasetDocuments' }) : t('segment.chunkDetail', { ns: 'datasetDocuments' })
  const labelPrefix = docForm === ChunkingMode.parentChild ? t('segment.parentChunk', { ns: 'datasetDocuments' }) : t('segment.chunk', { ns: 'datasetDocuments' })
  const isECOIndexing = indexingTechnique === IndexingType.ECONOMICAL

  return (
    <div className="flex h-full flex-col">
      <div className={cn(
        'flex shrink-0 items-center justify-between',
        fullScreen ? 'border border-divider-subtle py-3 pl-6 pr-4' : 'pl-4 pr-3 pt-3',
      )}
      >
        <div className="flex flex-col">
          <div className="system-xl-semibold text-text-primary">{titleText}</div>
          <div className="flex items-center gap-x-2">
            <SegmentIndexTag positionId={segInfo?.position || ''} label={isFullDocMode ? labelPrefix : ''} labelPrefix={labelPrefix} />
            <Dot />
            <span className="system-xs-medium text-text-tertiary">{wordCountText}</span>
          </div>
        </div>
        <div className="flex items-center">
          {isEditMode && fullScreen && (
            <>
              <ActionButtons
                handleCancel={handleCancel}
                handleRegeneration={handleRegeneration}
                handleSave={handleSave}
                loading={loading}
                showRegenerationButton={runtimeMode === 'general'}
              />
              <Divider type="vertical" className="ml-4 mr-2 h-3.5 bg-divider-regular" />
            </>
          )}
          <div className="mr-1 flex h-8 w-8 cursor-pointer items-center justify-center p-1.5" onClick={toggleFullScreen}>
            {
              fullScreen
                ? <RiCollapseDiagonalLine className="h-4 w-4 text-text-tertiary" />
                : <RiExpandDiagonalLine className="h-4 w-4 text-text-tertiary" />
            }
          </div>
          <div className="flex h-8 w-8 cursor-pointer items-center justify-center p-1.5" onClick={onCancel}>
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      <div className={cn(
        'flex h-0 grow',
        fullScreen ? 'w-full flex-row justify-center gap-x-8 px-6 pt-6' : 'flex-col gap-y-1 px-4 py-3',
        !isEditMode && 'pb-0',
      )}
      >
        <div className={cn(
          isEditMode ? 'overflow-hidden whitespace-pre-line break-all' : 'overflow-y-auto',
          fullScreen ? 'w-1/2' : 'h-0 grow',
        )}
        >
          <ChunkContent
            docForm={docForm}
            question={question}
            answer={answer}
            onQuestionChange={question => setQuestion(question)}
            onAnswerChange={answer => setAnswer(answer)}
            isEditMode={isEditMode}
          />
        </div>

        <div className={cn('flex shrink-0 flex-col', fullScreen ? 'w-[320px] gap-y-2' : 'w-full gap-y-1')}>
          <ImageUploaderInChunk
            disabled={!isEditMode}
            value={attachments}
            onChange={onAttachmentsChange}
          />
          <SummaryText
            value={summary}
            onChange={summary => setSummary(summary)}
            disabled={!isEditMode}
          />
          {isECOIndexing && (
            <Keywords
              className="w-full"
              actionType={isEditMode ? 'edit' : 'view'}
              segInfo={segInfo}
              keywords={keywords}
              isEditMode={isEditMode}
              onKeywordsChange={keywords => setKeywords(keywords)}
            />
          )}
        </div>
      </div>
      {isEditMode && !fullScreen && (
        <div className="flex items-center justify-end border-t-[1px] border-t-divider-subtle p-4 pt-3">
          <ActionButtons
            handleCancel={handleCancel}
            handleRegeneration={handleRegeneration}
            handleSave={handleSave}
            loading={loading}
            showRegenerationButton={runtimeMode === 'general'}
          />
        </div>
      )}
      {
        showRegenerationModal && (
          <RegenerationModal
            isShow={showRegenerationModal}
            onConfirm={onConfirmRegeneration}
            onCancel={onCancelRegeneration}
            onClose={onCloseAfterRegeneration}
          />
        )
      }
    </div>
  )
}

export default React.memo(SegmentDetail)
