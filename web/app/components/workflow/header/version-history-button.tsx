import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import { useHotkey } from '@tanstack/react-hotkeys'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from '#i18n'
import useTheme from '@/hooks/use-theme'
import { ShortcutKbd } from '../shortcuts/shortcut-kbd'

const VERSION_HISTORY_HOTKEY = 'Mod+Shift+H'

type VersionHistoryButtonProps = {
  onClick: () => Promise<unknown> | unknown
}

const PopupContent = React.memo(() => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-x-1">
      <div className="px-0.5 system-xs-medium text-text-secondary">
        {t('common.versionHistory', { ns: 'workflow' })}
      </div>
      <ShortcutKbd hotkey={VERSION_HISTORY_HOTKEY} bgColor="gray" textColor="secondary" />
    </div>
  )
})

PopupContent.displayName = 'PopupContent'

const VersionHistoryButton: FC<VersionHistoryButtonProps> = ({
  onClick,
}) => {
  const { theme } = useTheme()
  const handleViewVersionHistory = useCallback(async () => {
    await onClick?.()
  }, [onClick])

  useHotkey(VERSION_HISTORY_HOTKEY, () => {
    void handleViewVersionHistory()
  }, {
    ignoreInputs: true,
  })

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            className={cn(
              'rounded-lg border border-transparent p-2',
              theme === 'dark' && 'border-black/5 bg-white/10 backdrop-blur-xs',
            )}
            onClick={handleViewVersionHistory}
          >
            <span className="i-ri-history-line size-4 text-components-button-secondary-text" />
          </Button>
        )}
      />
      <TooltipContent
        className="rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]"
      >
        <PopupContent />
      </TooltipContent>
    </Tooltip>
  )
}

export default VersionHistoryButton
