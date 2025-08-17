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
      className="w-full rounded-lg border border-gray-200 bg-white py-1.5 text-xs font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t('workflow.nodes.triggerSchedule.executeNow')}
    </button>
  )
}

export default ExecuteNowButton
