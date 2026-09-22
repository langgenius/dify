import type { ReactNode } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
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
          <IconButton size="lg" aria-label={label} onClick={onToggle} className={className}>
            <span aria-hidden className="inline-flex">
              {icon ??
                (expand ? (
                  <span className="i-ri-arrow-left-s-line size-4" />
                ) : (
                  <span className="i-ri-arrow-right-s-line size-4" />
                ))}
            </span>
          </IconButton>
        }
      />
      <TooltipContent placement="right" className="flex items-center gap-1">
        <span className="px-0.5">{label}</span>
        <KbdGroup>
          {detailSidebarToggleShortcutKeys.map((key) => (
            <Kbd key={key}>{formatForDisplay(key)}</Kbd>
          ))}
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  )
}
