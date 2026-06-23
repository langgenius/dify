'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from '#i18n'
import Dot from '../../documents/detail/completed/common/dot'
import { SegmentIndexTag } from '../../documents/detail/completed/common/segment-index-tag'
import Score from './score'

type Props = {
  readonly labelPrefix: string
  readonly positionId: number
  readonly wordCount: number
  readonly score: number
  readonly className?: string
}

const ResultItemMeta: FC<Props> = ({
  labelPrefix,
  positionId,
  wordCount,
  score,
  className,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex items-center justify-between', className)}>
      <div className="flex items-center space-x-2">
        <SegmentIndexTag
          labelPrefix={labelPrefix}
          positionId={positionId}
          className={cn('w-fit group-hover:opacity-100')}
        />
        <Dot />
        <div className="system-xs-medium text-text-tertiary">
          {wordCount}
          {' '}
          {t('segment.characters', { ns: 'datasetDocuments', count: wordCount })}
        </div>
      </div>
      <Score value={score} />
    </div>
  )
}

export default React.memo(ResultItemMeta)
