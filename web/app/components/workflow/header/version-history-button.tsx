import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import { VERSION_HISTORY_HOTKEY } from '../hotkeys'
import { ShortcutKbd } from '../shortcuts/shortcut-kbd'

type VersionHistoryButtonProps = {
  onClick: () => Promise<unknown> | unknown
}

export function VersionHistoryButton({ onClick }: VersionHistoryButtonProps) {
  const { t } = useTranslation(['workflow'])
  const label = t(($) => $['common.versionHistory'], { ns: 'workflow' })

  useHotkey(
    VERSION_HISTORY_HOTKEY,
    (event) => {
      if (event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      void onClick()
    },
    {
      ignoreInputs: true,
      preventDefault: false,
      stopPropagation: false,
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
            className="inset-ring-1 inset-ring-transparent dark:bg-white/10 dark:inset-ring-black/5 dark:backdrop-blur-xs"
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
