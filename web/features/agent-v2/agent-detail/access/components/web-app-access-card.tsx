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
import {
  WebAppAccessControlEntry,
  WebAppAccessControlEntrySkeleton,
} from '@/app/components/app/access-point/shared/web-app-access-control'
import CustomizeModal from '@/app/components/app/overview/customize'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import SettingsModal from '@/app/components/app/overview/settings'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import AppIcon from '@/app/components/base/app-icon'
import dynamic from '@/next/dynamic'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { useWebAppAccessControl } from './use-web-app-access-control'

const AccessControl = dynamic(() => import('@/app/components/app/app-access-control'), {
  ssr: false,
})

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
  const accessReady = Boolean(agent?.access_ready)
  const canManageWebApp = Boolean(appId && accessReady)
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
  const [showCustomizeModal, setShowCustomizeModal] = useState(false)
  const [showEmbeddedModal, setShowEmbeddedModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showAccessControl, setShowAccessControl] = useState(false)
  const accessControl = useWebAppAccessControl(agent, isLoading)
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
  const status = isLoading ? 'loading' : isEnabled ? 'inService' : 'disabled'
  const statusLabel = isLoading
    ? tCommon(($) => $.loading)
    : t(
        ($) =>
          $[
            isEnabled
              ? 'agentDetail.access.status.inService'
              : 'agentDetail.access.status.outOfService'
          ],
      )
  const icon = agent ? getSettingsIcon(agent) : null
  const notAvailableLabel = t(($) => $['agentDetail.access.workflow.notAvailable'])

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
    <>
      <AccessPointCard
        className="min-h-55.5"
        headingLevel={3}
        title={t(($) => $['agentDetail.access.webApp.title'])}
        description={t(($) => $['agentDetail.access.webApp.description'])}
        icon={
          icon ? (
            <AppIcon
              size="large"
              iconType={icon.icon_type}
              icon={icon.icon}
              background={icon.icon_background}
              imageUrl={icon.icon_url}
            />
          ) : (
            'i-ri-window-line'
          )
        }
        status={status}
        statusLabel={statusLabel}
        switchDisabled={isLoading || !canManageWebApp}
        switchLabel={t(($) => $['agentDetail.access.toggleSurface'], {
          name: t(($) => $['agentDetail.access.webApp.title']),
        })}
        onEnabledChange={handleEnabledChange}
        busy={isBusy}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!embeddedConfig}
              onClick={() => setShowEmbeddedModal(true)}
              className="flex items-center gap-1 px-3"
            >
              <span aria-hidden className="i-ri-window-line size-4" />
              {t(($) => $['agentDetail.access.webApp.actions.embedIntoSite'])}
            </Button>
            <Button
              variant="secondary"
              disabled={!customizeConfig}
              onClick={() => setShowCustomizeModal(true)}
              className="flex items-center gap-1 px-3"
            >
              <span aria-hidden className="i-custom-vender-deploy-code-block size-4" />
              {t(($) => $['agentDetail.access.webApp.actions.customFrontend'])}
            </Button>
            <Button
              variant="secondary"
              disabled={!settingsAppInfo || updateSiteMutation.isPending}
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center gap-1 px-3"
            >
              <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              {t(($) => $['agentDetail.access.webApp.actions.settings'])}
            </Button>
          </>
        }
      >
        <AccessPointUrl
          label={t(($) => $['agentDetail.access.webApp.accessUrl'])}
          value={webAppUrl || notAvailableLabel}
          enabled={isEnabled}
          copyDisabled={!webAppUrl}
          loading={isLoading}
          unavailableLabel={notAvailableLabel}
          showOpen
          showQrCode
          showRegenerate
          openLabel={t(($) => $['agentDetail.access.webApp.actions.open'])}
          openUrl={webAppUrl}
          qrCodeLabel={t(($) => $['agentDetail.access.webApp.showQrCode'])}
          qrCodeScanLabel={t(($) => $['agentDetail.access.webApp.qrCode.scanToShare'])}
          qrCodeDownloadLabel={t(($) => $['agentDetail.access.webApp.qrCode.download'])}
          regenerateLabel={t(($) => $['agentDetail.access.webApp.refreshUrl'])}
          regenerateDisabled={!canManageWebApp || isBusy}
          regenerating={resetAccessTokenMutation.isPending}
          onRegenerate={handleRefreshUrl}
          copyLabel={t(($) => $['agentDetail.access.copyAccessUrl'])}
          copiedLabel={tCommon(($) => $['operation.copied'])}
          onCopyError={() => {
            toast.error(t(($) => $['agentDetail.access.copyFailed']))
          }}
        />
        {accessControl.state === 'loading' && <WebAppAccessControlEntrySkeleton loading />}
        {accessControl.state === 'ready' && (
          <WebAppAccessControlEntry
            {...accessControl.entryProps}
            onClick={() => setShowAccessControl(true)}
          />
        )}
      </AccessPointCard>

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
      {showAccessControl && accessControl.state === 'ready' && (
        <AccessControl
          app={accessControl.app}
          onClose={() => setShowAccessControl(false)}
          onConfirm={() => setShowAccessControl(false)}
        />
      )}
    </>
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
