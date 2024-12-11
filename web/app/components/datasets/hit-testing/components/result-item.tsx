'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentIndexTag } from '../../documents/detail/completed'
import type { HitTesting } from '@/models/datasets'
import cn from '@/utils/classnames'
type Props = {
  payload: HitTesting
}

const ResultItem: FC<Props> = ({
  payload,
}) => {
  const { t } = useTranslation()
  const { segment } = payload
  const { position, word_count } = segment

  return (
    <div>
      <div className='flex justify-between items-center'>
        <div className='flex items-center space-x-2'>
          <SegmentIndexTag positionId={position} className={cn('w-fit group-hover:opacity-100')} />
          <div className='text-xs font-medium text-text-quaternary'>·</div>
          <div className='system-xs-medium text-text-tertiary'>{word_count} {t('datasetDocuments.segment.characters')}</div>
        </div>
        {/* Score */}
      </div>

    </div>
  )
}
export default React.memo(ResultItem)
