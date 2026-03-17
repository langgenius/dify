'use client'

import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  fromAppName: string
  fromAppId: string
}

const UpgradedFromBanner: FC<Props> = ({ fromAppName, fromAppId }) => {
  const { t } = useTranslation('workflow')
  const [visible, setVisible] = useState(true)

  const handleGoBack = useCallback(() => {
    window.location.href = `/app/${fromAppId}/workflow`
  }, [fromAppId])

  const handleClose = useCallback(() => {
    setVisible(false)
  }, [])

  if (!visible)
    return null

  return (
    <div className="flex items-center justify-between gap-2 border-b border-divider-subtle bg-components-panel-bg px-4 py-2">
      <span className="text-text-secondary system-xs-regular">
        {t('sandboxMigrationModal.upgradedFrom', { name: fromAppName })}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex items-center gap-0.5 text-text-accent system-xs-medium hover:text-text-accent-secondary"
          onClick={handleGoBack}
        >
          <span className="i-ri-arrow-left-line h-3.5 w-3.5" />
          {t('sandboxMigrationModal.viewOriginal')}
        </button>
        <button
          type="button"
          className="flex items-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
          onClick={handleClose}
        >
          <span className="i-ri-close-line h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default UpgradedFromBanner
