'use client'

import { useTranslation } from 'react-i18next'

export default function IpPoliciesPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      <p className="system-sm-medium text-text-secondary">
        {t(($) => $['studio.accessControl.emptyPoliciesTitle'], { ns: 'deployments' })}
      </p>
      <p className="max-w-md system-xs-regular text-text-tertiary">
        {t(($) => $['studio.accessControl.emptyPoliciesDescription'], { ns: 'deployments' })}
      </p>
    </div>
  )
}
