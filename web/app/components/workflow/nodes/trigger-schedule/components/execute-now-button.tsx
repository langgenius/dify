import React from 'react'
import { useTranslation } from 'react-i18next'

type ExecuteNowButtonProps = {
  onClick: () => void
  disabled?: boolean
}

const ExecuteNowButton = ({ onClick, disabled = false }: ExecuteNowButtonProps) => {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg py-1.5 text-xs font-medium text-components-button-secondary-text shadow-xs hover:bg-components-button-secondary-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t('workflow.nodes.triggerSchedule.executeNow')}
    </button>
  )
}

export default ExecuteNowButton
