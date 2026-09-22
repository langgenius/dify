import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import useTheme from '@/hooks/use-theme'
import { VERSION_HISTORY_HOTKEY } from '../hotkeys'
import { ShortcutKbd } from '../shortcuts/shortcut-kbd'

type VersionHistoryButtonProps = {
  onClick: () => Promise<unknown> | unknown
}

export function VersionHistoryButton({ onClick }: VersionHistoryButtonProps) {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const label = t(($) => $['common.versionHistory'], { ns: 'workflow' })

  useHotkey(
    VERSION_HISTORY_HOTKEY,
    () => {
      void onClick()
    },
    {
      ignoreInputs: true,
    },
  )

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            aria-label={label}
            variant="secondary"
            size="lg"
            className={cn(
              'inset-ring-1 inset-ring-transparent',
              theme === 'dark' && 'bg-white/10 inset-ring-black/5 backdrop-blur-xs',
            )}
            onClick={onClick}
          >
            <span
              aria-hidden
              className="i-ri-history-line size-4 text-components-button-secondary-text"
            />
          </IconButton>
        }
      />
      <TooltipContent className="flex items-center gap-1">
        <span className="px-0.5">{label}</span>
        <ShortcutKbd
          hotkey={VERSION_HISTORY_HOTKEY}

          bgColor="gray"
          textColor="secondary"
        />
      </TooltipContent>
    </Tooltip>
  )
}
