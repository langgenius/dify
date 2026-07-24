import type { FC } from 'react'
import { RiFileList2Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type IEmptyProps = {
  onClearFilter: () => void
}

const EmptyCard = React.memo(() => {
  return (
    <div className="h-32 w-full shrink-0 rounded-xl bg-background-section-burn opacity-30" />
  )
})

EmptyCard.displayName = 'EmptyCard'

type LineProps = {
  className?: string
}

const Line = React.memo(({
  className,
}: LineProps) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="2" height="241" viewBox="0 0 2 241" fill="none" className={className}>
      <path d="M1 0.5L1 240.5" stroke="url(#paint0_linear_1989_74474)" />
      <defs>
        <linearGradient id="paint0_linear_1989_74474" x1="-7.99584" y1="240.5" x2="-7.88094" y2="0.50004" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.01" />
          <stop offset="0.503965" stopColor="#101828" stopOpacity="0.08" />
          <stop offset="1" stopColor="white" stopOpacity="0.01" />
        </linearGradient>
      </defs>
    </svg>
  )
})

Line.displayName = 'Line'

const Empty: FC<IEmptyProps> = ({
  onClearFilter,
}) => {
  const { t } = useTranslation()

  return (
    <div className="relative z-0 flex h-full items-center justify-center">
      <div className="flex flex-col items-center">
        <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-xl border border-divider-subtle bg-components-card-bg shadow-lg shadow-shadow-shadow-5">
          <RiFileList2Line className="h-6 w-6 text-text-secondary" />
          <Line className="absolute -right-px top-1/2 -translate-y-1/2" />
          <Line className="absolute -left-px top-1/2 -translate-y-1/2" />
          <Line className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rotate-90" />
          <Line className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 rotate-90" />
        </div>
        <div className="system-md-regular mt-3 text-text-tertiary">
          {t('segment.empty', { ns: 'datasetDocuments' })}
        </div>
        <button
          type="button"
          className="system-sm-medium mt-1 text-text-accent"
          onClick={onClearFilter}
        >
          {t('segment.clearFilter', { ns: 'datasetDocuments' })}
        </button>
      </div>
      <div className="absolute left-0 top-0 -z-20 flex h-full w-full flex-col gap-y-3 overflow-hidden">
        {
          Array.from({ length: 10 }).map((_, i) => (
            <EmptyCard key={i} />
          ))
        }
      </div>
      <div className="absolute left-0 top-0 -z-10 h-full w-full bg-dataset-chunk-list-mask-bg" />
    </div>
  )
}

export default React.memo(Empty)
