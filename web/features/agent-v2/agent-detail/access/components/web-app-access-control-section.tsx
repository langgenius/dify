'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessControl from '@/app/components/app/app-access-control'
import {
  ACCESS_MODE_ICON_MAP,
  ACCESS_MODE_LABEL_MAP,
} from '@/app/components/app/app-access-control/constants'
import { isAppAccessConfigured } from '@/app/components/app/overview/app-card-utils'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useAppACLCapabilities } from '@/hooks/use-app-acl-capabilities'
import { AccessMode, isAccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control'

export function WebAppAccessControlSection({
  agent,
  onAccessModeUpdated,
}: {
  agent?: AgentAppDetailWithSite
  onAccessModeUpdated: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [showAccessControl, setShowAccessControl] = useState(false)
  const appId = agent?.app_id
  const rawAccessMode = agent?.access_mode
  const accessMode = isAccessMode(rawAccessMode) ? rawAccessMode : undefined
  const { data: systemFeatures } = useQuery(systemFeaturesQueryOptions())
  const { canReleaseAndVersion: canManageWebAppAccessControl } = useAppACLCapabilities(
    agent?.permission_keys,
    agent?.maintainer,
  )
  const showSection = Boolean(
    systemFeatures?.webapp_auth.enabled && canManageWebAppAccessControl && appId,
  )
  const { data: whiteListSubjects } = useAppWhiteListSubjects(
    appId ?? undefined,
    showSection && accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  const displayMode = accessMode ?? AccessMode.SPECIFIC_GROUPS_MEMBERS
  const isAccessSet =
    accessMode !== undefined &&
    isAppAccessConfigured({ access_mode: accessMode }, whiteListSubjects)

  if (!showSection || !appId) return null

  const Icon = ACCESS_MODE_ICON_MAP[displayMode]

  const handleConfirm = async () => {
    setShowAccessControl(false)
    try {
      await onAccessModeUpdated()
    } catch (error) {
      console.error('Failed to refresh agent detail:', error)
    }
  }

  return (
    <div className="w-full">
      <div className="pb-1 system-xs-medium text-text-tertiary">
        {t(($) => $['publishApp.title'], { ns: 'app' })}
      </div>
      <button
        type="button"
        className="flex h-9 w-full items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pr-2 pl-2.5 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={() => setShowAccessControl(true)}
      >
        <span className="flex grow items-center gap-x-1.5 pr-1">
          <Icon className="size-4 shrink-0 text-text-secondary" />
          <span className="system-sm-medium text-text-secondary">
            {t(ACCESS_MODE_LABEL_MAP[displayMode], { ns: 'app' })}
          </span>
        </span>
        {!isAccessSet && (
          <span className="shrink-0 system-xs-regular text-text-tertiary">
            {t(($) => $['publishApp.notSet'], { ns: 'app' })}
          </span>
        )}
        <span className="flex size-4 shrink-0 items-center justify-center">
          <span aria-hidden className="i-ri-arrow-right-s-line size-4 text-text-quaternary" />
        </span>
      </button>
      {showAccessControl && (
        <AccessControl
          app={{ id: appId, access_mode: displayMode }}
          onClose={() => setShowAccessControl(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}
