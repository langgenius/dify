import { memo, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useParams } from 'next/navigation'
import { RiCloseLine, RiExpandDiagonalLine } from '@remixicon/react'
import { useKeyPress } from 'ahooks'
import { SegmentIndexTag, useSegmentListContext } from './completed'
import Drawer from '@/app/components/base/drawer'
import Button from '@/app/components/base/button'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea/common'
import { ToastContext } from '@/app/components/base/toast'
import type { SegmentUpdater } from '@/models/datasets'
import { addSegment } from '@/service/datasets'
import TagInput from '@/app/components/base/tag-input'
import classNames from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import Divider from '@/app/components/base/divider'

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
  const { datasetId, documentId } = useParams<{ datasetId: string; documentId: string }>()
  const [keywords, setKeywords] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fullScreen, toggleFullScreen] = useSegmentListContext(s => [s.fullScreen, s.toggleFullScreen])

  const handleCancel = () => {
    onCancel()
    setQuestion('')
    setAnswer('')
    setKeywords([])
  }

  const handleSave = async () => {
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

  useKeyPress(['esc'], (e) => {
    e.preventDefault()
    handleCancel()
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.s`, (e) => {
    e.preventDefault()
    handleSave()
  }
  , { exactMatch: true, useCapture: true })

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
        className='body-md-regular text-text-secondary tracking-[-0.07px] caret-[#295EFF]'
        value={question}
        placeholder={t('datasetDocuments.segment.contentPlaceholder') || ''}
        onChange={e => setQuestion(e.target.value)}
        autoFocus
      />
    )
  }

  const renderActionButtons = () => {
    return (
      <div className='flex items-center gap-x-2'>
        <Button
          onClick={handleCancel}
        >
          <div className='flex items-center gap-x-1'>
            <span className='text-components-button-secondary-text system-sm-medium'>{t('common.operation.cancel')}</span>
            <span className='px-[1px] bg-components-kbd-bg-gray rounded-[4px] text-text-tertiary system-kbd'>ESC</span>
          </div>
        </Button>
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={loading}
        >
          <div className='flex items-center gap-x-1'>
            <span className='text-components-button-primary-text'>{t('common.operation.save')}</span>
            <div className='flex items-center gap-x-0.5'>
              <span className='w-4 h-4 bg-components-kbd-bg-white rounded-[4px] text-text-primary-on-surface system-kbd capitalize'>{getKeyboardKeyNameBySystem('ctrl')}</span>
              <span className='w-4 h-4 bg-components-kbd-bg-white rounded-[4px] text-text-primary-on-surface system-kbd'>S</span>
            </div>
          </div>
        </Button>
      </div>
    )
  }

  const renderKeywords = () => {
    return (
      <div className={classNames('flex flex-col', fullScreen ? 'w-1/5' : '')}>
        <div className='text-text-tertiary system-xs-medium-uppercase'>{t('datasetDocuments.segment.keywords')}</div>
        <div className='text-text-tertiary w-full max-h-[200px] overflow-auto flex flex-wrap gap-1'>
          <TagInput items={keywords} onChange={newKeywords => setKeywords(newKeywords)} />
        </div>
      </div>
    )
  }

  return (
    <Drawer
      isOpen={isShow}
      onClose={() => {}}
      panelClassname={`!p-0 ${fullScreen
        ? '!max-w-full !w-full'
        : 'mt-16 mr-2 mb-2 !max-w-[560px] !w-[560px] border-[0.5px] border-components-panel-border rounded-xl'}`}
      mask={false}
      unmount
      footer={null}
    >
      <div className={'flex flex-col h-full'}>
        <div className={classNames('flex items-center justify-between', fullScreen ? 'py-3 pr-4 pl-6 border border-divider-subtle' : 'pt-3 pr-3 pl-4')}>
          <div className='flex flex-col'>
            <div className='text-text-primary system-xl-semibold'>{
              docForm === 'qa_model'
                ? t('datasetDocuments.segment.newQaSegment')
                : t('datasetDocuments.segment.addChunk')
            }</div>
            <div className='flex items-center gap-x-2'>
              <SegmentIndexTag label={'New Chunk'} />
              <span className='text-text-quaternary system-xs-medium'>·</span>
              <span className='text-text-tertiary system-xs-medium'>{formatNumber(question.length)} {t('datasetDocuments.segment.characters')}</span>
            </div>
          </div>
          <div className='flex items-center'>
            {fullScreen && (
              <>
                {renderActionButtons()}
                <Divider type='vertical' className='h-3.5 bg-divider-regular ml-4 mr-2' />
              </>
            )}
            <div className='w-8 h-8 flex justify-center items-center p-1.5 cursor-pointer mr-1' onClick={toggleFullScreen}>
              <RiExpandDiagonalLine className='w-4 h-4 text-text-tertiary' />
            </div>
            <div className='w-8 h-8 flex justify-center items-center p-1.5 cursor-pointer' onClick={handleCancel}>
              <RiCloseLine className='w-4 h-4 text-text-tertiary' />
            </div>
          </div>
        </div>
        <div className={classNames('flex grow overflow-hidden', fullScreen ? 'w-full flex-row justify-center px-6 pt-6 gap-x-8' : 'flex-col gap-y-1 py-3 px-4')}>
          <div className={classNames('break-all overflow-y-auto whitespace-pre-line', fullScreen ? 'w-1/2' : 'grow')}>
            {renderContent()}
          </div>
          {renderKeywords()}
        </div>
        {!fullScreen && (
          <div className='flex items-center justify-end p-4 pt-3 border-t-[1px] border-t-divider-subtle'>
            {renderActionButtons()}
          </div>
        )}
      </div>
    </Drawer>
  )
}

export default memo(NewSegmentModal)
