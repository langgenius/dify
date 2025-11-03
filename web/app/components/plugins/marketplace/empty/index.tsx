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
      className={cn('relative flex h-0 grow flex-wrap overflow-hidden p-2', className)}
    >
      {
        Array.from({ length: 16 }).map((_, index) => (
          <div
            key={index}
            className={cn(
              'mb-3 mr-3 h-[144px] w-[calc((100%-36px)/4)] rounded-xl bg-background-section-burn',
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
            className='absolute inset-0 z-[1] bg-marketplace-plugin-empty'
          ></div>
        )
      }
      <div className='absolute left-1/2 top-1/2 z-[2] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center'>
        <div className='relative mb-3 flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-divider-deep bg-components-card-bg shadow-lg'>
          <Group className='h-5 w-5 text-text-primary' />
          <Line className='absolute right-[-1px] top-1/2 -translate-y-1/2' />
          <Line className='absolute left-[-1px] top-1/2 -translate-y-1/2' />
          <Line className='absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rotate-90' />
          <Line className='absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 rotate-90' />
        </div>
        <div className='system-md-regular text-center text-text-tertiary'>
          {text || t('plugin.marketplace.noPluginFound')}
        </div>
      </div>
    </div>
  )
}

export default Empty
