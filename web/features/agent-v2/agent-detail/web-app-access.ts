'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode, isAccessMode } from '@/models/access-control'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'

export function useWebAppAccessPermission(agent: AgentAppDetailWithSite | undefined) {
  const appId = agent?.backing_app_id ?? undefined
  const accessMode = isAccessMode(agent?.access_mode) ? agent.access_mode : undefined
  const { data: webAppAuthEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (systemFeatures) => systemFeatures.webapp_auth.enabled,
  })
  const { data: userCanAccessApp, refetch: refetchUserCanAccessApp } = useGetUserCanAccessApp({
    appId,
    enabled: Boolean(webAppAuthEnabled && appId),
  })
  return {
    noAccessPermission:
      webAppAuthEnabled && accessMode !== AccessMode.EXTERNAL_MEMBERS && !userCanAccessApp?.result,
    refetchUserCanAccessApp,
  }
}

export function getAgentWebAppUrl(agent?: AgentAppDetailWithSite) {
  const site = agent?.site
  const token = site?.access_token ?? site?.code
  if (!token) return ''

  const baseUrl =
    site?.app_base_url || (typeof window === 'undefined' ? '' : window.location.origin)
  return `${baseUrl.replace(/\/$/, '')}/agent/${token}`
}
