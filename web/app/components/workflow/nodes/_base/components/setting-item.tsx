import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { PropsWithChildren, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'

type SettingItemProps = PropsWithChildren<{
  label: string
  status?: 'error' | 'warning'
  tooltip?: ReactNode
}>

export const SettingItem = memo(({ label, children, status, tooltip }: SettingItemProps) => {
  const indicator: StatusDotStatus | undefined = status === 'error' ? 'error' : status === 'warning' ? 'warning' : undefined
  const needTooltip = ['error', 'warning'].includes(status as any)
  return (
    <div className="relative flex items-center justify-between space-x-1 rounded-md bg-workflow-block-parma-bg px-1.5 py-1 text-xs font-normal">
      <div className={cn('max-w-full shrink-0 truncate system-xs-medium-uppercase text-text-tertiary', !!children && 'max-w-[100px]')}>
        {label}
      </div>
      <Tooltip>
        <TooltipTrigger
          disabled={!needTooltip}
          render={(
            <div className="truncate text-right system-xs-medium text-text-secondary">
              {children}
            </div>
          )}
        />
        <TooltipContent>
          {tooltip}
        </TooltipContent>
      </Tooltip>
      {indicator && <StatusDot status={indicator} className="absolute -top-0.5 -right-0.5" />}
    </div>
  )
})

SettingItem.displayName = 'SettingItem'
