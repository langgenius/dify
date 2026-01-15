import type { FC } from 'react'
import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { SegmentUpdater } from '@/models/datasets'
import { RiCloseLine, RiExpandDiagonalLine } from '@remixicon/react'
import { useParams } from 'next/navigation'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import Divider from '@/app/components/base/divider'
import { ToastContext } from '@/app/components/base/toast'
import ImageUploaderInChunk from '@/app/components/datasets/common/image-uploader/image-uploader-in-chunk'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { ChunkingMode } from '@/models/datasets'
import { useAddSegment } from '@/service/knowledge/use-segment'
import { cn } from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import { IndexingType } from '../../create/step-two'
import { useSegmentListContext } from './completed'
import ActionButtons from './completed/common/action-buttons'
import AddAnother from './completed/common/add-another'
import ChunkContent from './completed/common/chunk-content'
import Dot from './completed/common/dot'
import Keywords from './completed/common/keywords'
import { SegmentIndexTag } from './completed/common/segment-index-tag'

type NewSegmentModalProps = {
  onCancel: () => void
  docForm: ChunkingMode
  onSave: () => void
  viewNewlyAddedChunk: () => void
}

const NewSegmentModal: FC<NewSegmentModalProps> = ({
  onCancel,
  docForm,
  onSave,
  viewNewlyAddedChunk,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [attachments, setAttachments] = useState<FileEntity[]>([])
  const { datasetId, documentId } = useParams<{ datasetId: string, documentId: string }>()
  const [keywords, setKeywords] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [addAnother, setAddAnother] = useState(true)
  const fullScreen = useSegmentListContext(s => s.fullScreen)
  const toggleFullScreen = useSegmentListContext(s => s.toggleFullScreen)
  const indexingTechnique = useDatasetDetailContextWithSelector(s => s.dataset?.indexing_technique)
  const { appSidebarExpand } = useAppStore(useShallow(state => ({
    appSidebarExpand: state.appSidebarExpand,
  })))
  const [imageUploaderKey, setImageUploaderKey] = useState(Date.now())
  const refreshTimer = useRef<any>(null)

  const CustomButton = useMemo(() => (
    <>
      <Divider type="vertical" className="mx-1 h-3 bg-divider-regular" />
      <button
        type="button"
        className="system-xs-semibold text-text-accent"
        onClick={() => {
          clearTimeout(refreshTimer.current)
          viewNewlyAddedChunk()
        }}
      >
        {t('operation.view', { ns: 'common' })}
      </button>
    </>
  ), [viewNewlyAddedChunk, t])

  const handleCancel = useCallback((actionType: 'esc' | 'add' = 'esc') => {
    if (actionType === 'esc' || !addAnother)
      onCancel()
  }, [onCancel, addAnother])

  const onAttachmentsChange = useCallback((attachments: FileEntity[]) => {
    setAttachments(attachments)
  }, [])

  const { mutateAsync: addSegment } = useAddSegment()

  const handleSave = useCallback(async () => {
    const params: SegmentUpdater = { content: '', attachment_ids: [] }
    if (docForm === ChunkingMode.qa) {
      if (!question.trim()) {
        return notify({
          type: 'error',
          message: t('segment.questionEmpty', { ns: 'datasetDocuments' }),
        })
      }
      if (!answer.trim()) {
        return notify({
          type: 'error',
          message: t('segment.answerEmpty', { ns: 'datasetDocuments' }),
        })
      }

      params.content = question
      params.answer = answer
    }
    else {
      if (!question.trim()) {
        return notify({
          type: 'error',
          message: t('segment.contentEmpty', { ns: 'datasetDocuments' }),
        })
      }

      params.content = question
    }

    if (keywords?.length)
      params.keywords = keywords

    if (attachments.length)
      params.attachment_ids = attachments.filter(item => Boolean(item.uploadedId)).map(item => item.uploadedId!)

    setLoading(true)
    await addSegment({ datasetId, documentId, body: params }, {
      onSuccess() {
        notify({
          type: 'success',
          message: t('segment.chunkAdded', { ns: 'datasetDocuments' }),
          className: `!w-[296px] !bottom-0 ${appSidebarExpand === 'expand' ? '!left-[216px]' : '!left-14'}
          !top-auto !right-auto !mb-[52px] !ml-11`,
          customComponent: CustomButton,
        })
        handleCancel('add')
        setQuestion('')
        setAnswer('')
        setAttachments([])
        setImageUploaderKey(Date.now())
        setKeywords([])
        refreshTimer.current = setTimeout(() => {
          onSave()
        }, 3000)
      },
      onSettled() {
        setLoading(false)
      },
    })
  }, [docForm, keywords, addSegment, datasetId, documentId, question, answer, attachments, notify, t, appSidebarExpand, CustomButton, handleCancel, onSave])

  const wordCountText = useMemo(() => {
    const count = docForm === ChunkingMode.qa ? (question.length + answer.length) : question.length
    return `${formatNumber(count)} ${t('segment.characters', { ns: 'datasetDocuments', count })}`
  }, [question.length, answer.length, docForm, t])

  const isECOIndexing = indexingTechnique === IndexingType.ECONOMICAL

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn('flex items-center justify-between', fullScreen ? 'border border-divider-subtle py-3 pl-6 pr-4' : 'pl-4 pr-3 pt-3')}
      >
        <div className="flex flex-col">
          <div className="system-xl-semibold text-text-primary">
            {t('segment.addChunk', { ns: 'datasetDocuments' })}
          </div>
          <div className="flex items-center gap-x-2">
            <SegmentIndexTag label={t('segment.newChunk', { ns: 'datasetDocuments' })!} />
            <Dot />
            <span className="system-xs-medium text-text-tertiary">{wordCountText}</span>
          </div>
        </div>
        <div className="flex items-center">
          {fullScreen && (
            <>
              <AddAnother className="mr-3" isChecked={addAnother} onCheck={() => setAddAnother(!addAnother)} />
              <ActionButtons
                handleCancel={handleCancel.bind(null, 'esc')}
                handleSave={handleSave}
                loading={loading}
                actionType="add"
              />
              <Divider type="vertical" className="ml-4 mr-2 h-3.5 bg-divider-regular" />
            </>
          )}
          <div className="mr-1 flex h-8 w-8 cursor-pointer items-center justify-center p-1.5" onClick={toggleFullScreen}>
            <RiExpandDiagonalLine className="h-4 w-4 text-text-tertiary" />
          </div>
          <div className="flex h-8 w-8 cursor-pointer items-center justify-center p-1.5" onClick={handleCancel.bind(null, 'esc')}>
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      <div className={cn('flex grow', fullScreen ? 'w-full flex-row justify-center gap-x-8 px-6 pt-6' : 'flex-col gap-y-1 px-4 py-3')}>
        <div className={cn('overflow-hidden whitespace-pre-line break-all', fullScreen ? 'w-1/2' : 'grow')}>
          <ChunkContent
            docForm={docForm}
            question={question}
            answer={answer}
            onQuestionChange={question => setQuestion(question)}
            onAnswerChange={answer => setAnswer(answer)}
            isEditMode={true}
          />
        </div>
        <div className={cn('flex flex-col', fullScreen ? 'w-[320px] gap-y-2' : 'w-full gap-y-1')}>
          <ImageUploaderInChunk
            key={imageUploaderKey}
            value={attachments}
            onChange={onAttachmentsChange}
          />
          {isECOIndexing && (
            <Keywords
              className={fullScreen ? 'w-1/5' : ''}
              actionType="add"
              keywords={keywords}
              isEditMode={true}
              onKeywordsChange={keywords => setKeywords(keywords)}
            />
          )}
        </div>
      </div>
      {!fullScreen && (
        <div className="flex items-center justify-between border-t-[1px] border-t-divider-subtle p-4 pt-3">
          <AddAnother isChecked={addAnother} onCheck={() => setAddAnother(!addAnother)} />
          <ActionButtons
            handleCancel={handleCancel.bind(null, 'esc')}
            handleSave={handleSave}
            loading={loading}
            actionType="add"
          />
        </div>
      )}
    </div>
  )
}

export default memo(NewSegmentModal)
