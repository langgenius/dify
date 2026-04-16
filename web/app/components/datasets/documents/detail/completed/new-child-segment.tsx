import type { FC } from 'react'
import type { ChildChunkDetail, SegmentUpdater } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { RiCloseLine, RiExpandDiagonalLine } from '@remixicon/react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { toast } from '@/app/components/base/ui/toast'
import { ChunkingMode } from '@/models/datasets'
import { useParams } from '@/next/navigation'
import { useAddChildSegment } from '@/service/knowledge/use-segment'
import { formatNumber } from '@/utils/format'
import { useDocumentContext } from '../context'
import ActionButtons from './common/action-buttons'
import AddAnother from './common/add-another'
import ChunkContent from './common/chunk-content'
import Dot from './common/dot'
import { SegmentIndexTag } from './common/segment-index-tag'
import { useSegmentListContext } from './index'

type NewChildSegmentModalProps = {
  chunkId: string
  onCancel: () => void
  onSave: (ChildChunk?: ChildChunkDetail) => void
  viewNewlyAddedChildChunk?: () => void
}

const NewChildSegmentModal: FC<NewChildSegmentModalProps> = ({
  chunkId,
  onCancel,
  onSave,
  viewNewlyAddedChildChunk,
}) => {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const { datasetId, documentId } = useParams<{ datasetId: string, documentId: string }>()
  const [loading, setLoading] = useState(false)
  const [addAnother, setAddAnother] = useState(true)
  const fullScreen = useSegmentListContext(s => s.fullScreen)
  const toggleFullScreen = useSegmentListContext(s => s.toggleFullScreen)
  const parentMode = useDocumentContext(s => s.parentMode)

  const isFullDocMode = parentMode === 'full-doc'

  const handleCancel = (actionType: 'esc' | 'add' = 'esc') => {
    if (actionType === 'esc' || !addAnother)
      onCancel()
  }

  const { mutateAsync: addChildSegment } = useAddChildSegment()

  const handleSave = async () => {
    const params: SegmentUpdater = { content: '' }

    if (!content.trim())
      return toast.error(t('segment.contentEmpty', { ns: 'datasetDocuments' }))

    params.content = content

    setLoading(true)
    await addChildSegment({ datasetId, documentId, segmentId: chunkId, body: params }, {
      onSuccess(res) {
        toast.success(t('segment.childChunkAdded', { ns: 'datasetDocuments' }), {
          actionProps: isFullDocMode
            ? {
                children: t('operation.view', { ns: 'common' }),
                onClick: viewNewlyAddedChildChunk,
              }
            : undefined,
        })
        handleCancel('add')
        setContent('')
        if (isFullDocMode) {
          onSave()
        }
        else {
          onSave(res.data)
        }
      },
      onSettled() {
        setLoading(false)
      },
    })
  }

  const count = content.length
  const wordCountText = `${formatNumber(count)} ${t('segment.characters', { ns: 'datasetDocuments', count })}`

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center justify-between', fullScreen ? 'border border-divider-subtle py-3 pr-4 pl-6' : 'pt-3 pr-3 pl-4')}>
        <div className="flex flex-col">
          <div className="system-xl-semibold text-text-primary">{t('segment.addChildChunk', { ns: 'datasetDocuments' })}</div>
          <div className="flex items-center gap-x-2">
            <SegmentIndexTag label={t('segment.newChildChunk', { ns: 'datasetDocuments' }) as string} />
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
                isChildChunk={true}
              />
              <Divider type="vertical" className="mr-2 ml-4 h-3.5 bg-divider-regular" />
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
      <div className={cn('flex w-full grow', fullScreen ? 'flex-row justify-center px-6 pt-6' : 'px-4 py-3')}>
        <div className={cn('h-full overflow-hidden break-all whitespace-pre-line', fullScreen ? 'w-1/2' : 'w-full')}>
          <ChunkContent
            docForm={ChunkingMode.parentChild}
            question={content}
            onQuestionChange={content => setContent(content)}
            isEditMode={true}
          />
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
            isChildChunk={true}
          />
        </div>
      )}
    </div>
  )
}

export default memo(NewChildSegmentModal)
