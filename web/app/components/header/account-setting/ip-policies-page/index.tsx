'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IpPolicyDialog } from './policy-dialog'

export default function IpPoliciesPage() {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['settings.ipPolicies'], { ns: 'common' })}
          </h2>
          <p className="system-sm-regular text-text-tertiary">
            {t(($) => $['settings.ipPoliciesDescription'], { ns: 'common' })}
          </p>
        </div>
        <Button variant="primary" size="small" onClick={() => setDialogOpen(true)}>
          {t(($) => $['settings.ipPolicyAddEntry'], { ns: 'common' })}
        </Button>
      </div>

      <div className="flex flex-col items-center gap-1 py-10 text-center">
        <p className="system-sm-medium text-text-secondary">
          {t(($) => $['studio.accessControl.emptyPoliciesTitle'], { ns: 'deployments' })}
        </p>
        <p className="max-w-md system-xs-regular text-text-tertiary">
          {t(($) => $['studio.accessControl.emptyPoliciesDescription'], { ns: 'deployments' })}
        </p>
      </div>

      {dialogOpen && <IpPolicyDialog mode="create" open onOpenChange={setDialogOpen} />}
    </div>
  )
}
