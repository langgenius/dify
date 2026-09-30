import type { Hotkey } from '@tanstack/react-hotkeys'
import type { RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'

const JSON_SCHEMA_CONFIRM_HOTKEY = 'Mod+Enter' satisfies Hotkey

type AdvancedActionsProps = {
  target: RefObject<HTMLDivElement | null>
  isConfirmDisabled: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function AdvancedActions({
  target,
  isConfirmDisabled,
  onCancel,
  onConfirm,
}: AdvancedActionsProps) {
  const { t } = useTranslation(['common'])

  useHotkey(
    JSON_SCHEMA_CONFIRM_HOTKEY,
    (event) => {
      if (event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      onConfirm()
    },
    {
      target,
      enabled: !isConfirmDisabled,
      preventDefault: false,
      stopPropagation: false,
      ignoreInputs: false,
    },
  )

  return (
    <div className="flex items-center gap-x-1">
      <Button size="small" variant="secondary" onClick={onCancel}>
        {t(($) => $['operation.cancel'], { ns: 'common' })}
      </Button>
      <Button
        className="flex items-center"
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
