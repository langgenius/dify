import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type SegmentProgressProps = {
  completedSegments?: number
  totalSegments?: number
  percent: number
}

const SegmentProgress: FC<SegmentProgressProps> = React.memo(({
  completedSegments,
  totalSegments,
  percent,
}) => {
  const { t } = useTranslation()

  const completed = completedSegments ?? '--'
  const total = totalSegments ?? '--'

  return (
    <div className="flex w-full items-center">
      <span className="system-xs-medium text-text-secondary">
        {`${t('embedding.segments', { ns: 'datasetDocuments' })} ${completed}/${total} · ${percent}%`}
      </span>
    </div>
  )
})

SegmentProgress.displayName = 'SegmentProgress'

export default SegmentProgress
