import type { Hotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'

const JSON_SCHEMA_CONFIRM_HOTKEY = 'Mod+Enter' satisfies Hotkey

type AdvancedActionsProps = {
  isConfirmDisabled: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function AdvancedActions({ isConfirmDisabled, onCancel, onConfirm }: AdvancedActionsProps) {
  const { t } = useTranslation()

  useHotkey(
    JSON_SCHEMA_CONFIRM_HOTKEY,
    () => {
      onConfirm()
    },
    {
      enabled: !isConfirmDisabled,
      ignoreInputs: false,
    },
  )

  return (
    <div className="flex items-center gap-x-1">
      <Button size="small" variant="secondary" onClick={onCancel}>
        {t(($) => $['operation.cancel'], { ns: 'common' })}
      </Button>
      <Button
        className="flex items-center gap-x-1"
        disabled={isConfirmDisabled}
        size="small"
        variant="primary"
        onClick={onConfirm}
      >
        <span>{t(($) => $['operation.confirm'], { ns: 'common' })}</span>
        <ShortcutKbd hotkey={JSON_SCHEMA_CONFIRM_HOTKEY} bgColor="white" />
      </Button>
    </div>
  )
}
