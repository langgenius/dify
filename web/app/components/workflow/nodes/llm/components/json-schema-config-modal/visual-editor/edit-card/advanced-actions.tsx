import type { FC } from 'react'
import { useKeyPress } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils'

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

  useKeyPress([`${getKeyboardKeyCodeBySystem('ctrl')}.enter`], (e) => {
    e.preventDefault()
    onConfirm()
  }, {
    exactMatch: true,
    useCapture: true,
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
        <ShortcutsName keys={['ctrl', '⏎']} bgColor="white" />
      </Button>
    </div>
  )
}

export default React.memo(AdvancedActions)
