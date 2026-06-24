'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CustomizeModal from '@/app/components/app/overview/customize'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import ShareQRCode from '@/app/components/base/qrcode'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from '@/service/client'
import { accessSurfaceActionClassName, AccessSurfaceCard } from './access-surface-card'

export function WebAppAccessCard({
  agent,
  agentId,
  isLoading,
}: {
  agent?: AgentAppDetailWithSite
  agentId: string
  isLoading: boolean
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const appId = agent?.app_id
  const apiBaseUrl = agent?.api_base_url
  const site = agent?.site
  const accessToken = site?.access_token ?? site?.code
  const appBaseUrl = site?.app_base_url || (typeof window === 'undefined' ? '' : window.location.origin)
  const webAppUrl = getAgentWebAppUrl(agent)
  const isEnabled = Boolean(agent?.enable_site)
  const canManageWebApp = Boolean(appId)
  const embeddedConfig = appId && accessToken
    ? {
        accessToken,
        appBaseUrl,
        siteInfo: {
          title: site?.title ?? agent?.name ?? '',
          chat_color_theme: site?.chat_color_theme ?? undefined,
          chat_color_theme_inverted: site?.chat_color_theme_inverted ?? undefined,
        },
      }
    : null
  const customizeConfig = appId && apiBaseUrl
    ? {
        apiBaseUrl,
        appId,
      }
    : null
  const showSsoBadge = agent?.access_mode === AccessMode.EXTERNAL_MEMBERS
  const [showCustomizeModal, setShowCustomizeModal] = useState(false)
  const [showEmbeddedModal, setShowEmbeddedModal] = useState(false)
  const toggleSiteMutation = useMutation(consoleQuery.apps.byAppId.siteEnable.post.mutationOptions({
    onSuccess: (_updatedApp, variables) => {
      queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
        consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
        agentDetail => agentDetail
          ? {
              ...agentDetail,
              enable_site: variables.body.enable_site,
            }
          : agentDetail,
      )
      toast.success(tCommon('actionMsg.modifiedSuccessfully'))
    },
    onError: () => {
      toast.error(tCommon('actionMsg.modifiedUnsuccessfully'))
    },
  }))
  const resetAccessTokenMutation = useMutation(consoleQuery.apps.byAppId.site.accessTokenReset.post.mutationOptions({
    onSuccess: (site) => {
      queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
        consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
        (agentDetail) => {
          if (!agentDetail || !agentDetail.site)
            return agentDetail

          return {
            ...agentDetail,
            site: {
              ...agentDetail.site,
              ...site,
              access_token: site.code,
            },
          }
        },
      )
      toast.success(tCommon('actionMsg.generatedSuccessfully'))
    },
    onError: () => {
      toast.error(tCommon('actionMsg.generatedUnsuccessfully'))
    },
  }))
  const isBusy = toggleSiteMutation.isPending || resetAccessTokenMutation.isPending

  function handleEnabledChange(enabled: boolean) {
    if (!appId)
      return

    toggleSiteMutation.mutate({
      params: {
        app_id: appId,
      },
      body: {
        enable_site: enabled,
      },
    })
  }

  function handleRefreshUrl() {
    if (!appId)
      return

    resetAccessTokenMutation.mutate({
      params: {
        app_id: appId,
      },
    })
  }

  return (
    <AccessSurfaceCard
      title={t('agentDetail.access.webApp.title')}
      icon="i-ri-window-line"
      iconClassName="bg-state-accent-solid text-text-primary-on-surface"
      endpointLabel={t('agentDetail.access.webApp.accessUrl')}
      endpoint={webAppUrl}
      enabled={isEnabled}
      onEnabledChange={handleEnabledChange}
      copyLabel={t('agentDetail.access.copyAccessUrl')}
      badge={showSsoBadge ? <SsoBadge /> : undefined}
      endpointActions={webAppUrl
        ? (
            <>
              <span className="mx-1.5 h-3.5 w-px shrink-0 bg-divider-regular" />
              <ShareQRCode content={webAppUrl} />
              <Button
                variant="ghost"
                size="small"
                className="size-6 shrink-0 px-0 text-text-tertiary hover:text-text-secondary"
                aria-label={t('agentDetail.access.webApp.refreshUrl')}
                disabled={!canManageWebApp || isBusy}
                onClick={handleRefreshUrl}
              >
                <span aria-hidden className="i-ri-refresh-line size-4" />
              </Button>
            </>
          )
        : undefined}
      disabled={isLoading || !canManageWebApp}
      busy={isBusy}
    >
      {webAppUrl && isEnabled
        ? (
            <a
              href={webAppUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t('agentDetail.access.webApp.actions.launch')}
              className={accessSurfaceActionClassName}
            >
              <span aria-hidden className="i-ri-external-link-line size-4" />
              {t('agentDetail.access.webApp.actions.launch')}
            </a>
          )
        : (
            <Button variant="secondary" size="medium" className="gap-1.5 px-3" disabled>
              <span aria-hidden className="i-ri-external-link-line size-4" />
              {t('agentDetail.access.webApp.actions.launch')}
            </Button>
          )}
      <Button
        variant="secondary"
        size="medium"
        className="gap-1.5 px-3"
        disabled={!embeddedConfig}
        onClick={() => setShowEmbeddedModal(true)}
      >
        <span aria-hidden className="i-ri-window-line size-4" />
        {t('agentDetail.access.webApp.actions.embedded')}
      </Button>
      <Button
        variant="secondary"
        size="medium"
        className="gap-1.5 px-3"
        disabled={!customizeConfig}
        onClick={() => setShowCustomizeModal(true)}
      >
        <span aria-hidden className="i-ri-paint-brush-line size-4" />
        {t('agentDetail.access.webApp.actions.customize')}
      </Button>
      <Button variant="secondary" size="medium" className="gap-1.5 px-3" disabled>
        <span aria-hidden className="i-ri-equalizer-2-line size-4" />
        {t('agentDetail.access.webApp.actions.settings')}
      </Button>
      {customizeConfig && (
        <CustomizeModal
          isShow={showCustomizeModal}
          onClose={() => setShowCustomizeModal(false)}
          appId={customizeConfig.appId}
          api_base_url={customizeConfig.apiBaseUrl}
          sourceCodeRepository="webapp-conversation"
        />
      )}
      {embeddedConfig && (
        <EmbeddedModal
          isShow={showEmbeddedModal}
          onClose={() => setShowEmbeddedModal(false)}
          appBaseUrl={embeddedConfig.appBaseUrl}
          accessToken={embeddedConfig.accessToken}
          siteInfo={embeddedConfig.siteInfo}
          webAppRoute="agent"
        />
      )}
    </AccessSurfaceCard>
  )
}

function getAgentWebAppUrl(agent?: AgentAppDetailWithSite) {
  const site = agent?.site
  const token = site?.access_token ?? site?.code
  if (!token)
    return ''

  const baseUrl = site?.app_base_url || (typeof window === 'undefined' ? '' : window.location.origin)
  return `${baseUrl.replace(/\/$/, '')}/agent/${token}`
}

function SsoBadge() {
  const { t } = useTranslation('agentV2')

  return (
    <span className="inline-flex h-4.5 shrink-0 items-center gap-1 rounded-sm border border-divider-deep px-1.5 system-2xs-semibold-uppercase text-text-tertiary">
      <span aria-hidden className="i-ri-shield-check-line size-3" />
      {t('agentDetail.access.webApp.ssoEnabled')}
    </span>
  )
}
