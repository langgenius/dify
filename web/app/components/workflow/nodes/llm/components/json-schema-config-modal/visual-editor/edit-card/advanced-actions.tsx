import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'
import { useWorkflowShortcut } from '@/app/components/workflow/shortcuts/use-workflow-hotkeys'

type AdvancedActionsProps = {
  isConfirmDisabled: boolean
  onCancel: () => void
  onConfirm: () => void
}

const AdvancedActions: FC<AdvancedActionsProps> = ({
  isConfirmDisabled,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation()

  useWorkflowShortcut('workflow.json-schema-confirm', () => {
    onConfirm()
  }, {
    enabled: !isConfirmDisabled,
    ignoreInputs: false,
  })

  return (
    <div className="flex items-center gap-x-1">
      <Button size="small" variant="secondary" onClick={onCancel}>
        {t('operation.cancel', { ns: 'common' })}
      </Button>
      <Button
        className="flex items-center gap-x-1"
        disabled={isConfirmDisabled}
        size="small"
        variant="primary"
        onClick={onConfirm}
      >
        <span>{t('operation.confirm', { ns: 'common' })}</span>
        <ShortcutKbd shortcut="workflow.json-schema-confirm" bgColor="white" />
      </Button>
    </div>
  )
}

export default React.memo(AdvancedActions)
