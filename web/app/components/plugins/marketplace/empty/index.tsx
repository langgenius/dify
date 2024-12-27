'use client'
import { Group } from '@/app/components/base/icons/src/vender/other'
import Line from './line'
import cn from '@/utils/classnames'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'

type Props = {
  text?: string
  lightCard?: boolean
  className?: string
  locale?: string
}

const Empty = ({
  text,
  lightCard,
  className,
  locale,
}: Props) => {
  const { t } = useMixedTranslation(locale)

  return (
    <div
      className={cn('grow relative h-0 flex flex-wrap p-2 overflow-hidden', className)}
    >
      {
        Array.from({ length: 16 }).map((_, index) => (
          <div
            key={index}
            className={cn(
              'mr-3 mb-3  h-[144px] w-[calc((100%-36px)/4)] rounded-xl bg-background-section-burn',
              index % 4 === 3 && 'mr-0',
              index > 11 && 'mb-0',
              lightCard && 'bg-background-default-lighter opacity-75',
            )}
          >
          </div>
        ))
      }
      {
        !lightCard && (
          <div
            className='absolute inset-0 bg-marketplace-plugin-empty z-[1]'
          ></div>
        )
      }
      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[2] flex flex-col items-center'>
        <div className='relative flex items-center justify-center mb-3 w-14 h-14 rounded-xl border border-dashed border-divider-deep bg-components-card-bg shadow-lg'>
          <Group className='w-5 h-5' />
          <Line className='absolute right-[-1px] top-1/2 -translate-y-1/2' />
          <Line className='absolute left-[-1px] top-1/2 -translate-y-1/2' />
          <Line className='absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90' />
          <Line className='absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90' />
        </div>
        <div className='text-center system-md-regular text-text-tertiary'>
          {text || t('plugin.marketplace.noPluginFound')}
        </div>
      </div>
    </div>
  )
}

export default Empty
