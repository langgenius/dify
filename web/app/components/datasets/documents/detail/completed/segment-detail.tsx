import React, { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiEditLine,
} from '@remixicon/react'
import { StatusItem } from '../../list'
import s from './style.module.css'
import { SegmentIndexTag } from '.'
import type { SegmentDetailModel } from '@/models/datasets'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea/common'
import Switch from '@/app/components/base/switch'
import Button from '@/app/components/base/button'
import TagInput from '@/app/components/base/tag-input'
import cn from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import Divider from '@/app/components/base/divider'

type ISegmentDetailProps = {
  embeddingAvailable: boolean
  segInfo?: Partial<SegmentDetailModel> & { id: string }
  onChangeSwitch?: (enabled: boolean, segId?: string) => Promise<void>
  onUpdate: (segmentId: string, q: string, a: string, k: string[]) => void
  onCancel: () => void
  archived?: boolean
  isEditing?: boolean
}

/**
 * Show all the contents of the segment
 */
const SegmentDetail: FC<ISegmentDetailProps> = ({
  embeddingAvailable,
  segInfo,
  archived,
  onChangeSwitch,
  onUpdate,
  onCancel,
  isEditing: initialIsEditing,
}) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(initialIsEditing)
  const [question, setQuestion] = useState(segInfo?.content || '')
  const [answer, setAnswer] = useState(segInfo?.answer || '')
  const [keywords, setKeywords] = useState<string[]>(segInfo?.keywords || [])
  const { eventEmitter } = useEventEmitterContextContext()
  const [loading, setLoading] = useState(false)

  eventEmitter?.useSubscription((v) => {
    if (v === 'update-segment')
      setLoading(true)
    else
      setLoading(false)
  })

  const handleCancel = () => {
    setIsEditing(false)
    setQuestion(segInfo?.content || '')
    setAnswer(segInfo?.answer || '')
    setKeywords(segInfo?.keywords || [])
  }
  const handleSave = () => {
    onUpdate(segInfo?.id || '', question, answer, keywords)
  }

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
            disabled={!isEditing}
          />
          <div className='mb-1 text-xs font-medium text-gray-500'>ANSWER</div>
          <AutoHeightTextarea
            outerClassName='mb-4'
            className='leading-6 text-md text-gray-800'
            value={answer}
            placeholder={t('datasetDocuments.segment.answerPlaceholder') || ''}
            onChange={e => setAnswer(e.target.value)}
            disabled={!isEditing}
            autoFocus
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
        disabled={!isEditing}
        autoFocus
      />
    )
  }

  return (
    <div className={'flex flex-col relative'}>
      <div className='absolute right-0 top-0 flex items-center h-7'>
        {isEditing && (
          <>
            <Button
              onClick={handleCancel}>
              {t('common.operation.cancel')}
            </Button>
            <Button
              variant='primary'
              className='ml-3'
              onClick={handleSave}
              disabled={loading}
            >
              {t('common.operation.save')}
            </Button>
          </>
        )}
        {!isEditing && !archived && embeddingAvailable && (
          <>
            <div className='group relative flex justify-center items-center w-6 h-6 hover:bg-gray-100 rounded-md cursor-pointer'>
              <div className={cn(s.editTip, 'hidden items-center absolute -top-10 px-3 h-[34px] bg-white rounded-lg whitespace-nowrap text-xs font-semibold text-gray-700 group-hover:flex')}>{t('common.operation.edit')}</div>
              <RiEditLine className='w-4 h-4 text-gray-500' onClick={() => setIsEditing(true)} />
            </div>
            <div className='mx-3 w-[1px] h-3 bg-gray-200' />
          </>
        )}
        <div className='flex justify-center items-center w-6 h-6 cursor-pointer' onClick={onCancel}>
          <RiCloseLine className='w-4 h-4 text-gray-500' />
        </div>
      </div>
      <SegmentIndexTag positionId={segInfo?.position || ''} className='w-fit mt-[2px] mb-6' />
      <div className={s.segModalContent}>{renderContent()}</div>
      <div className={s.keywordTitle}>{t('datasetDocuments.segment.keywords')}</div>
      <div className={s.keywordWrapper}>
        {!segInfo?.keywords?.length
          ? '-'
          : (
            <TagInput
              items={keywords}
              onChange={newKeywords => setKeywords(newKeywords)}
              disableAdd={!isEditing}
              disableRemove={!isEditing || (keywords.length === 1)}
            />
          )
        }
      </div>
      <div className={cn(s.footer, s.numberInfo)}>
        <div className='flex items-center flex-wrap gap-y-2'>
          <div className={cn(s.commonIcon, s.typeSquareIcon)} /><span className='mr-8'>{formatNumber(segInfo?.word_count as number)} {t('datasetDocuments.segment.characters')}</span>
          <div className={cn(s.commonIcon, s.targetIcon)} /><span className='mr-8'>{formatNumber(segInfo?.hit_count as number)} {t('datasetDocuments.segment.hitCount')}</span>
          <div className={cn(s.commonIcon, s.bezierCurveIcon)} /><span className={s.hashText}>{t('datasetDocuments.segment.vectorHash')}{segInfo?.index_node_hash}</span>
        </div>
        <div className='flex items-center'>
          <StatusItem status={segInfo?.enabled ? 'enabled' : 'disabled'} reverse textCls='text-gray-500 text-xs' />
          {embeddingAvailable && (
            <>
              <Divider type='vertical' className='!h-2' />
              <Switch
                size='md'
                defaultValue={segInfo?.enabled}
                onChange={async (val) => {
                  await onChangeSwitch?.(val, segInfo?.id || '')
                }}
                disabled={archived}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

SegmentDetail.displayName = 'SegmentDetail'

export default React.memo(SegmentDetail)
