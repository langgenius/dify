import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import { DETAIL_SIDEBAR_TOGGLE_HOTKEY } from './hotkeys'

const detailSidebarToggleShortcutKeys = DETAIL_SIDEBAR_TOGGLE_HOTKEY.split('+')

type DetailSidebarToggleButtonProps = {
  expand: boolean
  onToggle: () => void
  className?: string
  icon?: ReactNode
}

export function DetailSidebarToggleButton({
  expand,
  onToggle,
  className,
  icon,
}: DetailSidebarToggleButtonProps) {
  const { t } = useTranslation()
  const label = expand
    ? t(($) => $['sidebar.collapseSidebar'], { ns: 'layout' })
    : t(($) => $['sidebar.expandSidebar'], { ns: 'layout' })

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="small"
            aria-label={label}
            onClick={onToggle}
            className={cn('rounded-full px-1', className)}
          />
        }
      >
        {icon ??
          (expand ? (
            <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
          ) : (
            <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
          ))}
      </TooltipTrigger>
      <TooltipContent placement="right" className="rounded-lg p-1.5">
        <div className="flex items-center gap-x-1">
          <span className="px-0.5 system-xs-medium text-text-secondary">{label}</span>
          <KbdGroup>
            {detailSidebarToggleShortcutKeys.map((key) => (
              <Kbd key={key}>{formatForDisplay(key)}</Kbd>
            ))}
          </KbdGroup>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
