import { memo, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useParams } from 'next/navigation'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea/common'
import { Hash02 } from '@/app/components/base/icons/src/vender/line/general'
import { ToastContext } from '@/app/components/base/toast'
import type { SegmentUpdator } from '@/models/datasets'
import { addSegment } from '@/service/datasets'
import TagInput from '@/app/components/base/tag-input'

type NewSegmentModalProps = {
  isShow: boolean
  onCancel: () => void
  docForm: string
  onSave: () => void
}

const NewSegmentModal: FC<NewSegmentModalProps> = ({
  isShow,
  onCancel,
  docForm,
  onSave,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const { datasetId, documentId } = useParams()
  const [keywords, setKeywords] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const handleCancel = () => {
    setQuestion('')
    setAnswer('')
    onCancel()
    setKeywords([])
  }

  const handleSave = async () => {
    const params: SegmentUpdator = { content: '' }
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

    if (keywords?.length)
      params.keywords = keywords

    setLoading(true)
    try {
      await addSegment({ datasetId, documentId, body: params })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      handleCancel()
      onSave()
    }
    finally {
      setLoading(false)
    }
  }

  const renderContent = () => {
    if (docForm === 'qa_model') {
      return (
        <>
          <div className='mb-1 text-xs font-medium text-gray-500'>QUESTION</div>
          <AutoHeightTextarea
            outerClassName='mb-4'
            className='leading-6 text-md text-gray-800'
            value={question}
            placeholder={t('datasetDocuments.segment.questionPlaceholder') || ''}
            onChange={e => setQuestion(e.target.value)}
            autoFocus
          />
          <div className='mb-1 text-xs font-medium text-gray-500'>ANSWER</div>
          <AutoHeightTextarea
            outerClassName='mb-4'
            className='leading-6 text-md text-gray-800'
            value={answer}
            placeholder={t('datasetDocuments.segment.answerPlaceholder') || ''}
            onChange={e => setAnswer(e.target.value)}
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
        autoFocus
      />
    )
  }

  return (
    <Modal isShow={isShow} onClose={() => { }} className='pt-8 px-8 pb-6 !max-w-[640px] !rounded-xl'>
      <div className={'flex flex-col relative'}>
        <div className='absolute right-0 -top-0.5 flex items-center h-6'>
          <div className='flex justify-center items-center w-6 h-6 cursor-pointer' onClick={handleCancel}>
            <RiCloseLine className='w-4 h-4 text-gray-500' />
          </div>
        </div>
        <div className='mb-[14px]'>
          <span className='inline-flex items-center px-1.5 h-5 border border-gray-200 rounded-md'>
            <Hash02 className='mr-0.5 w-3 h-3 text-gray-400' />
            <span className='text-[11px] font-medium text-gray-500 italic'>
              {
                docForm === 'qa_model'
                  ? t('datasetDocuments.segment.newQaSegment')
                  : t('datasetDocuments.segment.newTextSegment')
              }
            </span>
          </span>
        </div>
        <div className='mb-4 py-1.5 h-[420px] overflow-auto'>{renderContent()}</div>
        <div className='text-xs font-medium text-gray-500'>{t('datasetDocuments.segment.keywords')}</div>
        <div className='mb-8'>
          <TagInput items={keywords} onChange={newKeywords => setKeywords(newKeywords)} />
        </div>
        <div className='flex justify-end'>
          <Button
            onClick={handleCancel}>
            {t('common.operation.cancel')}
          </Button>
          <Button
            variant='primary'
            onClick={handleSave}
            disabled={loading}
          >
            {t('common.operation.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default memo(NewSegmentModal)
