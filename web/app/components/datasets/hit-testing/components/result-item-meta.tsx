'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentIndexTag } from '../../documents/detail/completed/common/segment-index-tag'
import { Score } from './score'

type ResultItemMetaProps = {
  readonly labelPrefix: string
  readonly positionId: number
  readonly wordCount: number
  readonly score: number
  readonly className?: string
}

export const ResultItemMeta = memo(
  ({ labelPrefix, positionId, wordCount, score, className }: ResultItemMetaProps) => {
    const { t } = useTranslation(['datasetDocuments'])

    return (
      <span className={cn('flex items-center justify-between', className)}>
        <span className="flex items-center space-x-2">
          <SegmentIndexTag
            labelPrefix={labelPrefix}
            positionId={positionId}
            className={cn('w-fit group-hover:opacity-100')}
          />
          <span className="system-xs-medium text-text-quaternary">·</span>
          <span className="system-xs-medium text-text-tertiary">
            {wordCount}{' '}
            {t(($) => $['segment.characters'], { ns: 'datasetDocuments', count: wordCount })}
          </span>
        </span>
        <Score value={score} />
      </span>
    )
  },
)
