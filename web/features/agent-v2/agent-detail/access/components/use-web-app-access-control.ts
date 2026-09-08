'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import type { SelectorParam } from 'i18next'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode, isAccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control/use-app-access-control'
import { getAppACLCapabilities } from '@/utils/permission'

const ACCESS_MODE_ICON_MAP: Record<AccessMode, string> = {
  [AccessMode.ORGANIZATION]: 'i-ri-building-line',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'i-ri-lock-line',
  [AccessMode.PUBLIC]: 'i-ri-global-line',
  [AccessMode.EXTERNAL_MEMBERS]: 'i-ri-verified-badge-line',
}

const ACCESS_MODE_LABEL_MAP: Record<AccessMode, SelectorParam<'app'>> = {
  [AccessMode.ORGANIZATION]: ($) => $['accessControlDialog.accessItems.organization'],
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: ($) => $['accessControlDialog.accessItems.specific'],
  [AccessMode.PUBLIC]: ($) => $['accessControlDialog.accessItems.anyone'],
  [AccessMode.EXTERNAL_MEMBERS]: ($) => $['accessControlDialog.accessItems.external'],
}

export function useWebAppAccessControl(
  agent: AgentAppDetailWithSite | undefined,
  isLoading: boolean,
) {
  const { t } = useTranslation()
  const appId = agent?.backing_app_id ?? undefined
  const accessMode = isAccessMode(agent?.access_mode) ? agent.access_mode : undefined
  const { data: webAppAuthEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (systemFeatures) => systemFeatures.webapp_auth.enabled,
  })
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { canReleaseAndVersion: canManage } = getAppACLCapabilities(agent?.permission_keys, {
    currentUserId,
    resourceMaintainer: agent?.maintainer,
    workspacePermissionKeys,
  })
  const hasAccessControl = Boolean(webAppAuthEnabled && appId && accessMode)
  const { data: accessSubjects } = useAppWhiteListSubjects(
    appId,
    hasAccessControl && canManage && accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  const accessConfigured =
    !accessSubjects ||
    accessMode !== AccessMode.SPECIFIC_GROUPS_MEMBERS ||
    Boolean(accessSubjects.groups.length || accessSubjects.members.length)

  if (!webAppAuthEnabled) return { state: 'hidden' as const }
  if (isLoading) return { state: 'loading' as const }
  if (!appId || !accessMode) return { state: 'hidden' as const }

  return {
    state: 'ready' as const,
    app: { id: appId, access_mode: accessMode },
    entryProps: {
      accessConfigured,
      accessIcon: ACCESS_MODE_ICON_MAP[accessMode],
      accessLabel: t(ACCESS_MODE_LABEL_MAP[accessMode], { ns: 'app' }),
      disabled: !canManage,
    },
  }
}
