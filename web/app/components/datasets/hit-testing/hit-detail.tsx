import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentIndexTag } from '../documents/detail/completed'
import s from '../documents/detail/completed/style.module.css'
import cn from '@/utils/classnames'
import type { SegmentDetailModel } from '@/models/datasets'
import Divider from '@/app/components/base/divider'

type IHitDetailProps = {
  segInfo?: Partial<SegmentDetailModel> & { id: string }
}

const HitDetail: FC<IHitDetailProps> = ({ segInfo }) => {
  const { t } = useTranslation()

  const renderContent = () => {
    if (segInfo?.answer) {
      return (
        <>
          <div className='mt-2 mb-1 text-xs font-medium text-gray-500'>QUESTION</div>
          <div className='mb-4 text-md text-gray-800'>{segInfo.content}</div>
          <div className='mb-1 text-xs font-medium text-gray-500'>ANSWER</div>
          <div className='text-md text-gray-800'>{segInfo.answer}</div>
        </>
      )
    }

    return segInfo?.content
  }

  return (
    <div className='overflow-x-auto'>
      <div className="bg-gray-25 p-6">
        <div className="flex items-center">
          <SegmentIndexTag
            positionId={segInfo?.position || ''}
            className="w-fit mr-6"
          />
          <div className={cn(s.commonIcon, s.typeSquareIcon)} />
          <span className={cn('mr-6', s.numberInfo)}>
            {segInfo?.word_count} {t('datasetDocuments.segment.characters')}
          </span>
          <div className={cn(s.commonIcon, s.targetIcon)} />
          <span className={s.numberInfo}>
            {segInfo?.hit_count} {t('datasetDocuments.segment.hitCount')}
          </span>
        </div>
        <Divider />
        <div className={s.segModalContent}>{renderContent()}</div>
        <div className={s.keywordTitle}>
          {t('datasetDocuments.segment.keywords')}
        </div>
        <div className={s.keywordWrapper}>
          {!segInfo?.keywords?.length
            ? '-'
            : segInfo?.keywords?.map((word, index) => {
              return <div key={index} className={s.keyword}>{word}</div>
            })}
        </div>
      </div>
    </div>
  )
}

export default HitDetail
