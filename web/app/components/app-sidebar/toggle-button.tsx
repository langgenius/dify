import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type ToggleTooltipContentProps = {
  expand: boolean
}

const TOGGLE_SHORTCUT = ['Mod', 'B']

const ToggleTooltipContent = ({
  expand,
}: ToggleTooltipContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1">
      <span className="px-0.5 system-xs-medium text-text-secondary">{expand ? t('sidebar.collapseSidebar', { ns: 'layout' }) : t('sidebar.expandSidebar', { ns: 'layout' })}</span>
      <KbdGroup>
        {TOGGLE_SHORTCUT.map(key => (
          <Kbd key={key}>{formatForDisplay(key)}</Kbd>
        ))}
      </KbdGroup>
    </div>
  )
}

type ToggleButtonProps = {
  expand: boolean
  handleToggle: () => void
  className?: string
  icon?: React.ReactNode
  iconClassName?: string
}

const ToggleButton = ({
  expand,
  handleToggle,
  className,
  icon,
  iconClassName,
}: ToggleButtonProps) => {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            size="small"
            onClick={handleToggle}
            className={cn('rounded-full px-1', className)}
          />
        )}
      >
        {icon
          || (iconClassName
            ? <span aria-hidden className={cn('size-4', iconClassName)} />
            : expand
              ? <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
              : <span aria-hidden className="i-ri-arrow-right-s-line size-4" />)}
      </TooltipTrigger>
      <TooltipContent placement="right" className="rounded-lg p-1.5">
        <ToggleTooltipContent expand={expand} />
      </TooltipContent>
    </Tooltip>
  )
}

export default React.memo(ToggleButton)
