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
  return <div className='bg-workflow-block-parma-bg relative flex items-center justify-between space-x-1 rounded-md px-1.5 py-1 text-xs font-normal'>
    <div className={classNames('shrink-0 truncate text-text-tertiary system-xs-medium-uppercase', !!children && 'max-w-[100px]')}>
      {label}
    </div>
    <Tooltip popupContent={tooltip} disabled={!needTooltip}>
      <div className='system-xs-medium text-text-secondary truncate text-right'>
        {children}
      </div>
    </Tooltip>
    {indicator && <Indicator color={indicator} className='absolute -right-0.5 -top-0.5' />}
  </div>
})

SettingItem.displayName = 'SettingItem'
