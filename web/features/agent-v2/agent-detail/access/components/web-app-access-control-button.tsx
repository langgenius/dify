'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessControl from '@/app/components/app/app-access-control'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { isAccessMode } from '@/models/access-control'
import { getAppACLCapabilities } from '@/utils/permission'

export function WebAppAccessControlButton({ agent }: { agent?: AgentAppDetailWithSite }) {
  const { t } = useTranslation('agentV2')
  const [showAccessControl, setShowAccessControl] = useState(false)
  const appId = agent?.backing_app_id
  const rawAccessMode = agent?.access_mode
  const accessMode = isAccessMode(rawAccessMode) ? rawAccessMode : undefined
  const { data: webAppAuthEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (systemFeatures) => systemFeatures.webapp_auth.enabled,
  })
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { canReleaseAndVersion: canManageWebAppAccessControl } = getAppACLCapabilities(
    agent?.permission_keys,
    {
      currentUserId,
      resourceMaintainer: agent?.maintainer,
      workspacePermissionKeys,
    },
  )

  if (!webAppAuthEnabled || !canManageWebAppAccessControl || !appId || !accessMode) return null

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
