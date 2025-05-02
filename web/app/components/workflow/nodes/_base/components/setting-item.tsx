import Tooltip from '@/app/components/base/tooltip'
import Indicator from '@/app/components/header/indicator'
import classNames from '@/utils/classnames'
import { type ComponentProps, type PropsWithChildren, type ReactNode, memo } from 'react'

export type SettingItemProps = PropsWithChildren<{
  label: string
  status?: 'error' | 'warning'
  tooltip?: ReactNode
}>

export const SettingItem = memo(({ label, children, status, tooltip }: SettingItemProps) => {
  const indicator: ComponentProps<typeof Indicator>['color'] = status === 'error' ? 'red' : status === 'warning' ? 'yellow' : undefined
  const needTooltip = ['error', 'warning'].includes(status as any)
  return <div className='flex items-center justify-between bg-workflow-block-parma-bg rounded-md py-1 px-1.5 space-x-1 text-xs font-normal relative'>
    <div className={classNames('shrink-0 truncate text-text-tertiary system-xs-medium-uppercase', !!children && 'max-w-[100px]')}>
      {label}
    </div>
    <Tooltip popupContent={tooltip} disabled={!needTooltip}>
      <div className='truncate text-right system-xs-medium text-text-secondary'>
        {children}
      </div>
    </Tooltip>
    {indicator && <Indicator color={indicator} className='absolute -right-0.5 -top-0.5' />}
  </div>
})

SettingItem.displayName = 'SettingItem'
