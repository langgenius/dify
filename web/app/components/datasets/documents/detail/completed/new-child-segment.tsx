import { memo, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useParams } from 'next/navigation'
import { RiCloseLine, RiExpandDiagonalLine } from '@remixicon/react'
import { useShallow } from 'zustand/react/shallow'
import { useDocumentContext } from '../context'
import { SegmentIndexTag } from './common/segment-index-tag'
import ActionButtons from './common/action-buttons'
import ChunkContent from './common/chunk-content'
import AddAnother from './common/add-another'
import Dot from './common/dot'
import { useSegmentListContext } from './index'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ToastContext } from '@/app/components/base/toast'
import { type ChildChunkDetail, ChunkingMode, type SegmentUpdater } from '@/models/datasets'
import classNames from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import Divider from '@/app/components/base/divider'
import { useAddChildSegment } from '@/service/knowledge/use-segment'

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
  const { notify } = useContext(ToastContext)
  const [content, setContent] = useState('')
  const { datasetId, documentId } = useParams<{ datasetId: string; documentId: string }>()
  const [loading, setLoading] = useState(false)
  const [addAnother, setAddAnother] = useState(true)
  const fullScreen = useSegmentListContext(s => s.fullScreen)
  const toggleFullScreen = useSegmentListContext(s => s.toggleFullScreen)
  const { appSidebarExpand } = useAppStore(useShallow(state => ({
    appSidebarExpand: state.appSidebarExpand,
  })))
  const parentMode = useDocumentContext(s => s.parentMode)

  const refreshTimer = useRef<any>(null)

  const isFullDocMode = useMemo(() => {
    return parentMode === 'full-doc'
  }, [parentMode])

  const CustomButton = <>
    <Divider type='vertical' className='mx-1 h-3 bg-divider-regular' />
    <button
      type='button'
      className='system-xs-semibold text-text-accent'
      onClick={() => {
        clearTimeout(refreshTimer.current)
        viewNewlyAddedChildChunk?.()
      }}>
      {t('common.operation.view')}
    </button>
  </>

  const handleCancel = (actionType: 'esc' | 'add' = 'esc') => {
    if (actionType === 'esc' || !addAnother)
      onCancel()
  }

  const { mutateAsync: addChildSegment } = useAddChildSegment()

  const handleSave = async () => {
    const params: SegmentUpdater = { content: '' }

    if (!content.trim())
      return notify({ type: 'error', message: t('datasetDocuments.segment.contentEmpty') })

    params.content = content

    setLoading(true)
    await addChildSegment({ datasetId, documentId, segmentId: chunkId, body: params }, {
      onSuccess(res) {
        notify({
          type: 'success',
          message: t('datasetDocuments.segment.childChunkAdded'),
          className: `!w-[296px] !bottom-0 ${appSidebarExpand === 'expand' ? '!left-[216px]' : '!left-14'}
          !top-auto !right-auto !mb-[52px] !ml-11`,
          customComponent: isFullDocMode && CustomButton,
        })
        handleCancel('add')
        setContent('')
        if (isFullDocMode) {
          refreshTimer.current = setTimeout(() => {
            onSave()
          }, 3000)
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

  const wordCountText = useMemo(() => {
    const count = content.length
    return `${formatNumber(count)} ${t('datasetDocuments.segment.characters', { count })}`
  }, [content.length])

  return (
    <div className={'flex h-full flex-col'}>
      <div className={classNames('flex items-center justify-between', fullScreen ? 'border border-divider-subtle py-3 pl-6 pr-4' : 'pl-4 pr-3 pt-3')}>
        <div className='flex flex-col'>
          <div className='system-xl-semibold text-text-primary'>{t('datasetDocuments.segment.addChildChunk')}</div>
          <div className='flex items-center gap-x-2'>
            <SegmentIndexTag label={t('datasetDocuments.segment.newChildChunk') as string} />
            <Dot />
            <span className='system-xs-medium text-text-tertiary'>{wordCountText}</span>
          </div>
        </div>
        <div className='flex items-center'>
          {fullScreen && (
            <>
              <AddAnother className='mr-3' isChecked={addAnother} onCheck={() => setAddAnother(!addAnother)} />
              <ActionButtons
                handleCancel={handleCancel.bind(null, 'esc')}
                handleSave={handleSave}
                loading={loading}
                actionType='add'
                isChildChunk={true}
              />
              <Divider type='vertical' className='ml-4 mr-2 h-3.5 bg-divider-regular' />
            </>
          )}
          <div className='mr-1 flex h-8 w-8 cursor-pointer items-center justify-center p-1.5' onClick={toggleFullScreen}>
            <RiExpandDiagonalLine className='h-4 w-4 text-text-tertiary' />
          </div>
          <div className='flex h-8 w-8 cursor-pointer items-center justify-center p-1.5' onClick={handleCancel.bind(null, 'esc')}>
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className={classNames('flex w-full grow', fullScreen ? 'flex-row justify-center px-6 pt-6' : 'px-4 py-3')}>
        <div className={classNames('h-full overflow-hidden whitespace-pre-line break-all', fullScreen ? 'w-1/2' : 'w-full')}>
          <ChunkContent
            docForm={ChunkingMode.parentChild}
            question={content}
            onQuestionChange={content => setContent(content)}
            isEditMode={true}
          />
        </div>
      </div>
      {!fullScreen && (
        <div className='flex items-center justify-between border-t-[1px] border-t-divider-subtle p-4 pt-3'>
          <AddAnother isChecked={addAnother} onCheck={() => setAddAnother(!addAnother)} />
          <ActionButtons
            handleCancel={handleCancel.bind(null, 'esc')}
            handleSave={handleSave}
            loading={loading}
            actionType='add'
            isChildChunk={true}
          />
        </div>
      )}
    </div>
  )
}

export default memo(NewChildSegmentModal)
