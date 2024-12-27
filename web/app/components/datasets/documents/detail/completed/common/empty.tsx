import React, { type FC } from 'react'
import { RiFileList2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

type IEmptyProps = {
  onClearFilter: () => void
}

const EmptyCard = React.memo(() => {
  return (
    <div className='w-full h-32 rounded-xl opacity-30 bg-background-section-burn shrink-0' />
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
      <path d="M1 0.5L1 240.5" stroke="url(#paint0_linear_1989_74474)"/>
      <defs>
        <linearGradient id="paint0_linear_1989_74474" x1="-7.99584" y1="240.5" x2="-7.88094" y2="0.50004" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.01"/>
          <stop offset="0.503965" stopColor="#101828" stopOpacity="0.08"/>
          <stop offset="1" stopColor="white" stopOpacity="0.01"/>
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
    <div className={'h-full relative flex items-center justify-center z-0'}>
      <div className='flex flex-col items-center'>
        <div className='relative z-10 flex items-center justify-center w-14 h-14 border border-divider-subtle bg-components-card-bg rounded-xl shadow-lg shadow-shadow-shadow-5'>
          <RiFileList2Line className='w-6 h-6 text-text-secondary' />
          <Line className='absolute -right-[1px] top-1/2 -translate-y-1/2' />
          <Line className='absolute -left-[1px] top-1/2 -translate-y-1/2' />
          <Line className='absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90' />
          <Line className='absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90' />
        </div>
        <div className='text-text-tertiary system-md-regular mt-3'>
          {t('datasetDocuments.segment.empty')}
        </div>
        <button
          type='button'
          className='text-text-accent system-sm-medium mt-1'
          onClick={onClearFilter}
        >
          {t('datasetDocuments.segment.clearFilter')}
        </button>
      </div>
      <div className='h-full w-full absolute top-0 left-0 flex flex-col gap-y-3 -z-20 overflow-hidden'>
        {
          Array.from({ length: 10 }).map((_, i) => (
            <EmptyCard key={i} />
          ))
        }
      </div>
      <div className='h-full w-full absolute top-0 left-0 bg-dataset-chunk-list-mask-bg -z-10' />
    </div>
  )
}

export default React.memo(Empty)
