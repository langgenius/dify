import { memo, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useParams } from 'next/navigation'
import { RiCloseLine, RiExpandDiagonalLine } from '@remixicon/react'
import { useShallow } from 'zustand/react/shallow'
import { useSegmentListContext } from './completed'
import { SegmentIndexTag } from './completed/common/segment-index-tag'
import ActionButtons from './completed/common/action-buttons'
import Keywords from './completed/common/keywords'
import ChunkContent from './completed/common/chunk-content'
import AddAnother from './completed/common/add-another'
import Dot from './completed/common/dot'
import { useDocumentContext } from './index'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ToastContext } from '@/app/components/base/toast'
import { ChunkingMode, type SegmentUpdater } from '@/models/datasets'
import classNames from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import Divider from '@/app/components/base/divider'
import { useAddSegment } from '@/service/knowledge/use-segment'

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
  const { datasetId, documentId } = useParams<{ datasetId: string; documentId: string }>()
  const [keywords, setKeywords] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [addAnother, setAddAnother] = useState(true)
  const fullScreen = useSegmentListContext(s => s.fullScreen)
  const toggleFullScreen = useSegmentListContext(s => s.toggleFullScreen)
  const mode = useDocumentContext(s => s.mode)
  const { appSidebarExpand } = useAppStore(useShallow(state => ({
    appSidebarExpand: state.appSidebarExpand,
  })))
  const refreshTimer = useRef<any>(null)

  const CustomButton = <>
    <Divider type='vertical' className='h-3 mx-1 bg-divider-regular' />
    <button
      type='button'
      className='text-text-accent system-xs-semibold'
      onClick={() => {
        clearTimeout(refreshTimer.current)
        viewNewlyAddedChunk()
      }}>
      {t('common.operation.view')}
    </button>
  </>

  const isQAModel = useMemo(() => {
    return docForm === ChunkingMode.qa
  }, [docForm])

  const handleCancel = (actionType: 'esc' | 'add' = 'esc') => {
    if (actionType === 'esc' || !addAnother)
      onCancel()
    setQuestion('')
    setAnswer('')
    setKeywords([])
  }

  const { mutateAsync: addSegment } = useAddSegment()

  const handleSave = async () => {
    const params: SegmentUpdater = { content: '' }
    if (isQAModel) {
      if (!question.trim()) {
        return notify({
          type: 'error',
          message: t('datasetDocuments.segment.questionEmpty'),
        })
      }
      if (!answer.trim()) {
        return notify({
          type: 'error',
          message: t('datasetDocuments.segment.answerEmpty'),
        })
      }

      params.content = question
      params.answer = answer
    }
    else {
      if (!question.trim()) {
        return notify({
          type: 'error',
          message: t('datasetDocuments.segment.contentEmpty'),
        })
      }

      params.content = question
    }

    if (keywords?.length)
      params.keywords = keywords

    setLoading(true)
    await addSegment({ datasetId, documentId, body: params }, {
      onSuccess() {
        notify({
          type: 'success',
          message: t('datasetDocuments.segment.chunkAdded'),
          className: `!w-[296px] !bottom-0 ${appSidebarExpand === 'expand' ? '!left-[216px]' : '!left-14'}
          !top-auto !right-auto !mb-[52px] !ml-11`,
          customComponent: CustomButton,
        })
        handleCancel('add')
        refreshTimer.current = setTimeout(() => {
          onSave()
        }, 3000)
      },
      onSettled() {
        setLoading(false)
      },
    })
  }

  const wordCountText = useMemo(() => {
    const count = isQAModel ? (question.length + answer.length) : question.length
    return `${formatNumber(count)} ${t('datasetDocuments.segment.characters', { count })}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.length, answer.length, isQAModel])

  return (
    <div className={'flex flex-col h-full'}>
      <div className={classNames('flex items-center justify-between', fullScreen ? 'py-3 pr-4 pl-6 border border-divider-subtle' : 'pt-3 pr-3 pl-4')}>
        <div className='flex flex-col'>
          <div className='text-text-primary system-xl-semibold'>{
            t('datasetDocuments.segment.addChunk')
          }</div>
          <div className='flex items-center gap-x-2'>
            <SegmentIndexTag label={t('datasetDocuments.segment.newChunk')!} />
            <Dot />
            <span className='text-text-tertiary system-xs-medium'>{wordCountText}</span>
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
              />
              <Divider type='vertical' className='h-3.5 bg-divider-regular ml-4 mr-2' />
            </>
          )}
          <div className='w-8 h-8 flex justify-center items-center p-1.5 cursor-pointer mr-1' onClick={toggleFullScreen}>
            <RiExpandDiagonalLine className='w-4 h-4 text-text-tertiary' />
          </div>
          <div className='w-8 h-8 flex justify-center items-center p-1.5 cursor-pointer' onClick={handleCancel.bind(null, 'esc')}>
            <RiCloseLine className='w-4 h-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className={classNames('flex grow', fullScreen ? 'w-full flex-row justify-center px-6 pt-6 gap-x-8' : 'flex-col gap-y-1 py-3 px-4')}>
        <div className={classNames('break-all overflow-hidden whitespace-pre-line', fullScreen ? 'w-1/2' : 'grow')}>
          <ChunkContent
            docForm={docForm}
            question={question}
            answer={answer}
            onQuestionChange={question => setQuestion(question)}
            onAnswerChange={answer => setAnswer(answer)}
            isEditMode={true}
          />
        </div>
        {mode === 'custom' && <Keywords
          className={fullScreen ? 'w-1/5' : ''}
          actionType='add'
          keywords={keywords}
          isEditMode={true}
          onKeywordsChange={keywords => setKeywords(keywords)}
        />}
      </div>
      {!fullScreen && (
        <div className='flex items-center justify-between p-4 pt-3 border-t-[1px] border-t-divider-subtle'>
          <AddAnother isChecked={addAnother} onCheck={() => setAddAnother(!addAnother)} />
          <ActionButtons
            handleCancel={handleCancel.bind(null, 'esc')}
            handleSave={handleSave}
            loading={loading}
            actionType='add'
          />
        </div>
      )}
    </div>
  )
}

export default memo(NewSegmentModal)
