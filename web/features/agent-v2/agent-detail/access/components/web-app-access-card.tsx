'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import type { AppSiteUpdatePayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ConfigParams, SettingsAppInfo } from '@/app/components/app/overview/settings'
import type { AppIconType } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CustomizeModal from '@/app/components/app/overview/customize'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import SettingsModal from '@/app/components/app/overview/settings'
import ShareQRCode from '@/app/components/base/qrcode'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
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
  const appBaseUrl =
    site?.app_base_url || (typeof window === 'undefined' ? '' : window.location.origin)
  const webAppUrl = getAgentWebAppUrl(agent)
  const isEnabled = Boolean(agent?.enable_site)
  const canManageWebApp = Boolean(appId)
  const embeddedConfig =
    appId && accessToken
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
  const settingsAppInfo = agent ? createSettingsAppInfo(agent) : null
  const customizeConfig =
    appId && apiBaseUrl
      ? {
          apiBaseUrl,
          appId,
        }
      : null
  const showSsoBadge = agent?.access_mode === AccessMode.EXTERNAL_MEMBERS
  const [showCustomizeModal, setShowCustomizeModal] = useState(false)
  const [showEmbeddedModal, setShowEmbeddedModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const agentDetailQueryKey = consoleQuery.agent.byAgentId.get.queryKey({
    input: { params: { agent_id: agentId } },
  })
  const toggleSiteMutation = useMutation(
    consoleQuery.apps.byAppId.siteEnable.post.mutationOptions({
      onSuccess: (_updatedApp, variables) => {
        queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
          agentDetailQueryKey,
          (agentDetail) =>
            agentDetail
              ? {
                  ...agentDetail,
                  enable_site: variables.body.enable_site,
                }
              : agentDetail,
        )
        toast.success(tCommon(($) => $['actionMsg.modifiedSuccessfully']))
      },
      onError: () => {
        toast.error(tCommon(($) => $['actionMsg.modifiedUnsuccessfully']))
      },
    }),
  )
  const resetAccessTokenMutation = useMutation(
    consoleQuery.apps.byAppId.site.accessTokenReset.post.mutationOptions({
      onSuccess: (site) => {
        queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
          agentDetailQueryKey,
          (agentDetail) => {
            if (!agentDetail || !agentDetail.site) return agentDetail

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
        toast.success(tCommon(($) => $['actionMsg.generatedSuccessfully']))
      },
      onError: () => {
        toast.error(tCommon(($) => $['actionMsg.generatedUnsuccessfully']))
      },
    }),
  )
  const updateSiteMutation = useMutation(consoleQuery.apps.byAppId.site.post.mutationOptions())
  const isBusy =
    toggleSiteMutation.isPending ||
    resetAccessTokenMutation.isPending ||
    updateSiteMutation.isPending

  function handleEnabledChange(enabled: boolean) {
    if (!appId) return

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
    if (!appId) return

    resetAccessTokenMutation.mutate({
      params: {
        app_id: appId,
      },
    })
  }

  async function handleSaveSettings(params: ConfigParams) {
    if (!appId) return

    const { enable_sso: _enableSso, ...body } = params
    const sitePayload = body satisfies AppSiteUpdatePayload

    try {
      const updatedSite = await updateSiteMutation.mutateAsync({
        params: {
          app_id: appId,
        },
        body: sitePayload,
      })

      queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
        agentDetailQueryKey,
        (agentDetail) =>
          agentDetail
            ? {
                ...agentDetail,
                site: {
                  ...agentDetail.site,
                  ...updatedSite,
                  ...sitePayload,
                  access_token:
                    updatedSite.code ??
                    agentDetail.site?.access_token ??
                    agentDetail.site?.code ??
                    null,
                  code:
                    updatedSite.code ??
                    agentDetail.site?.code ??
                    agentDetail.site?.access_token ??
                    null,
                  app_base_url: agentDetail.site?.app_base_url ?? site?.app_base_url ?? null,
                  icon_url: null,
                },
              }
            : agentDetail,
      )
      await queryClient.invalidateQueries({ queryKey: agentDetailQueryKey })
      toast.success(tCommon(($) => $['actionMsg.modifiedSuccessfully']))
    } catch {
      toast.error(tCommon(($) => $['actionMsg.modifiedUnsuccessfully']))
    }
  }

  return (
    <AccessSurfaceCard
      title={t(($) => $['agentDetail.access.webApp.title'])}
      icon="i-ri-window-line"
      iconClassName="bg-state-accent-solid text-text-primary-on-surface"
      endpointLabel={t(($) => $['agentDetail.access.webApp.accessUrl'])}
      endpoint={webAppUrl}
      enabled={isEnabled}
      onEnabledChange={handleEnabledChange}
      copyLabel={t(($) => $['agentDetail.access.copyAccessUrl'])}
      badge={showSsoBadge ? <SsoBadge /> : undefined}
      endpointActions={
        webAppUrl ? (
          <>
            <span className="mx-1.5 h-3.5 w-px shrink-0 bg-divider-regular" />
            <ShareQRCode content={webAppUrl} />
            <Button
              variant="ghost"
              size="small"
              className="size-6 shrink-0 px-0 text-text-tertiary hover:text-text-secondary"
              aria-label={t(($) => $['agentDetail.access.webApp.refreshUrl'])}
              disabled={!canManageWebApp || isBusy}
              onClick={handleRefreshUrl}
            >
              <span aria-hidden className="i-ri-refresh-line size-4" />
            </Button>
          </>
        ) : undefined
      }
      disabled={isLoading || !canManageWebApp}
      busy={isBusy}
    >
      {webAppUrl && isEnabled ? (
        <a
          href={webAppUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={t(($) => $['agentDetail.access.webApp.actions.launch'])}
          className={accessSurfaceActionClassName}
        >
          <span aria-hidden className="i-ri-external-link-line size-4" />
          {t(($) => $['agentDetail.access.webApp.actions.launch'])}
        </a>
      ) : (
        <Button variant="secondary" size="medium" className="gap-1.5 px-3" disabled>
          <span aria-hidden className="i-ri-external-link-line size-4" />
          {t(($) => $['agentDetail.access.webApp.actions.launch'])}
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
        {t(($) => $['agentDetail.access.webApp.actions.embedded'])}
      </Button>
      <Button
        variant="secondary"
        size="medium"
        className="gap-1.5 px-3"
        disabled={!customizeConfig}
        onClick={() => setShowCustomizeModal(true)}
      >
        <span aria-hidden className="i-ri-paint-brush-line size-4" />
        {t(($) => $['agentDetail.access.webApp.actions.customize'])}
      </Button>
      <Button
        variant="secondary"
        size="medium"
        className="gap-1.5 px-3"
        disabled={!settingsAppInfo || updateSiteMutation.isPending}
        onClick={() => setShowSettingsModal(true)}
      >
        <span aria-hidden className="i-ri-palette-line size-4" />
        {t(($) => $['agentDetail.access.webApp.actions.settings'])}
      </Button>
      {settingsAppInfo && (
        <SettingsModal
          isChat
          appInfo={settingsAppInfo}
          isShow={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          onSave={handleSaveSettings}
        />
      )}
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

function createSettingsAppInfo(agent: AgentAppDetailWithSite): SettingsAppInfo | null {
  const site = agent.site
  const appId = agent.app_id
  if (!site || !appId) return null
  const icon = getSettingsIcon(agent)

  return {
    id: appId,
    mode: AppModeEnum.CHAT,
    site: {
      title: site.title ?? agent.name,
      description: site.description ?? agent.description ?? '',
      default_language: (site.default_language ??
        'en-US') as SettingsAppInfo['site']['default_language'],
      chat_color_theme: site.chat_color_theme ?? '',
      chat_color_theme_inverted: site.chat_color_theme_inverted ?? false,
      copyright: site.copyright ?? '',
      privacy_policy: site.privacy_policy ?? '',
      custom_disclaimer: site.custom_disclaimer ?? '',
      input_placeholder: site.input_placeholder ?? '',
      icon_type: icon.icon_type,
      icon: icon.icon,
      icon_background: icon.icon_background,
      icon_url: icon.icon_url,
      show_workflow_steps: site.show_workflow_steps ?? false,
      use_icon_as_answer_icon: site.use_icon_as_answer_icon ?? false,
    },
  }
}

function isAppIconType(iconType: unknown): iconType is AppIconType {
  return iconType === 'image' || iconType === 'emoji' || iconType === 'link'
}

function getSettingsIcon(agent: AgentAppDetailWithSite) {
  const site = agent.site
  if (site && isAppIconType(site.icon_type) && site.icon) {
    return {
      icon_type: site.icon_type,
      icon: site.icon,
      icon_background: site.icon_background ?? null,
      icon_url: site.icon_url ?? null,
    }
  }

  if (isAppIconType(agent.icon_type) && agent.icon) {
    return {
      icon_type: agent.icon_type,
      icon: agent.icon,
      icon_background: agent.icon_background ?? null,
      icon_url: agent.icon_type === 'image' || agent.icon_type === 'link' ? agent.icon_url : null,
    }
  }

  return {
    icon_type: 'emoji' as const,
    icon: '',
    icon_background: null,
    icon_url: null,
  }
}

function getAgentWebAppUrl(agent?: AgentAppDetailWithSite) {
  const site = agent?.site
  const token = site?.access_token ?? site?.code
  if (!token) return ''

  const baseUrl =
    site?.app_base_url || (typeof window === 'undefined' ? '' : window.location.origin)
  return `${baseUrl.replace(/\/$/, '')}/agent/${token}`
}

function SsoBadge() {
  const { t } = useTranslation('agentV2')

  return (
    <span className="inline-flex h-4.5 shrink-0 items-center gap-1 rounded-sm border border-divider-deep px-1.5 system-2xs-semibold-uppercase text-text-tertiary">
      <span aria-hidden className="i-ri-shield-check-line size-3" />
      {t(($) => $['agentDetail.access.webApp.ssoEnabled'])}
    </span>
  )
}
