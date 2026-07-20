'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessControl from '@/app/components/app/app-access-control'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useAppACLCapabilities } from '@/hooks/use-app-acl-capabilities'
import { isAccessMode } from '@/models/access-control'

export function WebAppAccessControlButton({
  agent,
}: {
  agent?: AgentAppDetailWithSite
}) {
  const { t } = useTranslation('agentV2')
  const [showAccessControl, setShowAccessControl] = useState(false)
  const appId = agent?.backing_app_id
  const rawAccessMode = agent?.access_mode
  const accessMode = isAccessMode(rawAccessMode) ? rawAccessMode : undefined
  const { data: systemFeatures } = useQuery(systemFeaturesQueryOptions())
  const { canReleaseAndVersion: canManageWebAppAccessControl } = useAppACLCapabilities(
    agent?.permission_keys,
    agent?.maintainer,
  )

  if (!systemFeatures?.webapp_auth.enabled || !canManageWebAppAccessControl || !appId || !accessMode)
    return null

  return (
    <>
      <Button
        variant="secondary"
        size="medium"
        className="gap-1.5 px-3"
        onClick={() => setShowAccessControl(true)}
      >
        <span aria-hidden className="i-ri-lock-2-line size-4" />
        {t(($) => $['agentDetail.access.webApp.actions.accessControl'])}
      </Button>
      {showAccessControl && (
        <AccessControl
          app={{ id: appId, access_mode: accessMode }}
          onClose={() => setShowAccessControl(false)}
          onConfirm={() => setShowAccessControl(false)}
        />
      )}
    </>
  )
}
