import type { FC } from 'react'
import { useKeyPress } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'

type AdvancedActionsProps = {
  isConfirmDisabled: boolean
  onCancel: () => void
  onConfirm: () => void
}

const Key = (props: { keyName: string }) => {
  const { keyName } = props
  return (
    <kbd className="system-kbd flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-white px-px text-text-primary-on-surface">
      {keyName}
    </kbd>
  )
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
        <div className="flex items-center gap-x-0.5">
          <Key keyName={getKeyboardKeyNameBySystem('ctrl')} />
          <Key keyName="⏎" />
        </div>
      </Button>
    </div>
  )
}

export default React.memo(AdvancedActions)
