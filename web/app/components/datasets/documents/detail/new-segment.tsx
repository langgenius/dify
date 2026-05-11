import type { FC } from 'react'
import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { SegmentUpdater } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiCloseLine, RiExpandDiagonalLine } from '@remixicon/react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import ImageUploaderInChunk from '@/app/components/datasets/common/image-uploader/image-uploader-in-chunk'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { ChunkingMode } from '@/models/datasets'
import { useParams } from '@/next/navigation'
import { useAddSegment } from '@/service/knowledge/use-segment'
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
  const [imageUploaderKey, setImageUploaderKey] = useState(() => Date.now())

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
        return toast.error(t('segment.questionEmpty', { ns: 'datasetDocuments' }))
      }
      if (!answer.trim()) {
        return toast.error(t('segment.answerEmpty', { ns: 'datasetDocuments' }))
      }

      params.content = question
      params.answer = answer
    }
    else {
      if (!question.trim()) {
        return toast.error(t('segment.contentEmpty', { ns: 'datasetDocuments' }))
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
        toast.success(t('segment.chunkAdded', { ns: 'datasetDocuments' }), {
          actionProps: {
            children: t('operation.view', { ns: 'common' }),
            onClick: viewNewlyAddedChunk,
          },
        })
        handleCancel('add')
        setQuestion('')
        setAnswer('')
        setAttachments([])
        setImageUploaderKey(Date.now())
        setKeywords([])
        onSave()
      },
      onSettled() {
        setLoading(false)
      },
    })
  }, [docForm, keywords, addSegment, datasetId, documentId, question, answer, attachments, t, handleCancel, onSave, viewNewlyAddedChunk])

  const count = docForm === ChunkingMode.qa ? (question.length + answer.length) : question.length
  const wordCountText = `${formatNumber(count)} ${t('segment.characters', { ns: 'datasetDocuments', count })}`

  const isECOIndexing = indexingTechnique === IndexingType.ECONOMICAL

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn('flex items-center justify-between', fullScreen ? 'border border-divider-subtle py-3 pr-4 pl-6' : 'pt-3 pr-3 pl-4')}
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
              <Divider type="vertical" className="mr-2 ml-4 h-3.5 bg-divider-regular" />
            </>
          )}
          <button
            type="button"
            aria-label={t('operation.zoomIn', { ns: 'common' })}
            className="mr-1 flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent p-1.5"
            onClick={toggleFullScreen}
          >
            <RiExpandDiagonalLine className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('operation.close', { ns: 'common' })}
            className="flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent p-1.5"
            onClick={handleCancel.bind(null, 'esc')}
          >
            <RiCloseLine className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={cn('flex grow', fullScreen ? 'w-full flex-row justify-center gap-x-8 px-6 pt-6' : 'flex-col gap-y-1 px-4 py-3')}>
        <div className={cn('overflow-hidden break-all whitespace-pre-line', fullScreen ? 'w-1/2' : 'grow')}>
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
        <div className="flex items-center justify-between border-t border-t-divider-subtle p-4 pt-3">
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
