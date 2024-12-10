import React, { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiExpandDiagonalLine,
} from '@remixicon/react'
import { useKeyPress } from 'ahooks'
import { SegmentIndexTag, useSegmentListContext } from './index'
import type { SegmentDetailModel } from '@/models/datasets'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea/common'
import Button from '@/app/components/base/button'
import TagInput from '@/app/components/base/tag-input'
import { formatNumber } from '@/utils/format'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import classNames from '@/utils/classnames'
import Divider from '@/app/components/base/divider'

type ISegmentDetailProps = {
  segInfo?: Partial<SegmentDetailModel> & { id: string }
  onUpdate: (segmentId: string, q: string, a: string, k: string[]) => void
  onCancel: () => void
  isEditMode?: boolean
}

/**
 * Show all the contents of the segment
 */
const SegmentDetail: FC<ISegmentDetailProps> = ({
  segInfo,
  onUpdate,
  onCancel,
  isEditMode,
}) => {
  const { t } = useTranslation()
  const [question, setQuestion] = useState(segInfo?.content || '')
  const [answer, setAnswer] = useState(segInfo?.answer || '')
  const [keywords, setKeywords] = useState<string[]>(segInfo?.keywords || [])
  const { eventEmitter } = useEventEmitterContextContext()
  const [loading, setLoading] = useState(false)
  const [fullScreen, toggleFullScreen] = useSegmentListContext(s => [s.fullScreen, s.toggleFullScreen])

  eventEmitter?.useSubscription((v) => {
    if (v === 'update-segment')
      setLoading(true)
    else
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

  useKeyPress(['esc'], (e) => {
    e.preventDefault()
    handleCancel()
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.s`, (e) => {
    if (loading)
      return
    e.preventDefault()
    handleSave()
  }
  , { exactMatch: true, useCapture: true })

  const renderContent = () => {
    if (segInfo?.answer) {
      return (
        <>
          <div className='mb-1 text-xs font-medium text-gray-500'>QUESTION</div>
          <AutoHeightTextarea
            outerClassName='mb-4'
            className='leading-6 text-md text-gray-800'
            value={question}
            placeholder={t('datasetDocuments.segment.questionPlaceholder') || ''}
            onChange={e => setQuestion(e.target.value)}
            disabled={!isEditMode}
          />
          <div className='mb-1 text-xs font-medium text-gray-500'>ANSWER</div>
          <AutoHeightTextarea
            outerClassName='mb-4'
            className='leading-6 text-md text-gray-800'
            value={answer}
            placeholder={t('datasetDocuments.segment.answerPlaceholder') || ''}
            onChange={e => setAnswer(e.target.value)}
            disabled={!isEditMode}
            autoFocus
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
        disabled={!isEditMode}
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
          loading={loading}
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
          {!segInfo?.keywords?.length
            ? '-'
            : (
              <TagInput
                items={keywords}
                onChange={newKeywords => setKeywords(newKeywords)}
                disableAdd={!isEditMode}
                disableRemove={!isEditMode || (keywords.length === 1)}
              />
            )
          }
        </div>
      </div>
    )
  }

  return (
    <div className={'flex flex-col h-full'}>
      <div className={classNames('flex items-center justify-between', fullScreen ? 'py-3 pr-4 pl-6 border border-divider-subtle' : 'pt-3 pr-3 pl-4')}>
        <div className='flex flex-col'>
          <div className='text-text-primary system-xl-semibold'>{isEditMode ? 'Edit Chunk' : 'Chunk Detail'}</div>
          <div className='flex items-center gap-x-2'>
            <SegmentIndexTag positionId={segInfo?.position || ''} />
            <span className='text-text-quaternary system-xs-medium'>·</span>
            <span className='text-text-tertiary system-xs-medium'>{formatNumber(isEditMode ? question.length : segInfo?.word_count as number)} {t('datasetDocuments.segment.characters')}</span>
          </div>
        </div>
        <div className='flex items-center'>
          {isEditMode && fullScreen && (
            <>
              {renderActionButtons()}
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
          {renderContent()}
        </div>
        {renderKeywords()}
      </div>
      {isEditMode && !fullScreen && (
        <div className='flex items-center justify-end p-4 pt-3 border-t-[1px] border-t-divider-subtle'>
          {renderActionButtons()}
        </div>
      )}
    </div>
  )
}

export default React.memo(SegmentDetail)
