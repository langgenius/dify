import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { ModelProviderPluginSummary } from '../index'
import type { PluginDetail } from '@/app/components/plugins/types'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Badge from '@/app/components/base/badge'
import { OperationMenu } from '@/app/components/plugins/plugin-detail-panel/operation-menu'
import PluginInfoContent from '@/app/components/plugins/plugin-page/plugin-info'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { checkGitHubPluginUpdate } from '@/app/components/plugins/update-plugin/check-github-update'
import MarketplaceUpdateDialog from '@/app/components/plugins/update-plugin/from-market-place'
import { useModalContext } from '@/context/modal-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useTheme from '@/hooks/use-theme'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import { marketplaceQuery } from '@/service/marketplace'
import { normalizeInstalledPluginDetail, usePluginAutoUpgradeSettings } from '@/service/use-plugins'
import { isEarlierThanVersion } from '@/utils/semver'
import { getMarketplaceUrl } from '@/utils/var'

type Props =
  | Readonly<{
      summary: ModelProviderPluginSummary
      providerLabel: string
      onUpdate?: () => void | Promise<void>
      detail?: never
    }>
  | Readonly<{
      detail: PluginDetail
      onUpdate?: () => void | Promise<void>
      summary?: never
      providerLabel?: never
    }>

const pluginSourceMap: Record<ModelProviderPluginSummary['source'], PluginSource> = {
  github: PluginSource.github,
  marketplace: PluginSource.marketplace,
  package: PluginSource.local,
  remote: PluginSource.debugging,
}

type UpdateSession = {
  detail: PluginDetail
  target: Pick<
    PluginVersionsResponse['data']['versions'][number],
    'version' | 'unique_identifier'
  > & { warnAboutAutoUpdate: boolean }
}

function ProviderCardActions(props: Props) {
  const { t } = useTranslation(['appDebug', 'common', 'plugin', 'appLog'])
  const versionMenuLabelId = useId()
  const { formatDate } = useTimestamp()
  const dateFormat = t(($) => $.dateTimeFormat, { ns: 'appLog' }).split(' ')[0]!
  const queryClient = useQueryClient()
  const { canDeletePlugin, canUpdatePlugin } = usePluginSettingsAccess()
  const { setShowUpdatePluginModal } = useModalContext()
  const locale = useLocale()
  const { theme } = useTheme()
  const { onUpdate } = props
  const pluginID = props.detail ? props.detail.plugin_id : props.summary.plugin_id
  const source = props.detail ? props.detail.source : pluginSourceMap[props.summary.source]
  const version = props.detail?.version ?? props.summary?.version
  const latestVersion = props.detail?.latest_version ?? props.summary?.latestVersion
  const latestIdentifier =
    props.detail?.latest_unique_identifier ?? props.summary?.latestUniqueIdentifier
  const isFromMarketplace = source === PluginSource.marketplace
  const isFromGitHub = source === PluginSource.github
  const canChangeVersion = canUpdatePlugin && isFromMarketplace
  const hasNewVersion = isFromMarketplace && !!latestVersion && latestVersion !== version
  const category = props.detail?.declaration.category ?? PluginCategoryEnum.model
  const autoUpgradeSettings = usePluginAutoUpgradeSettings(category)
  const { data: enableMarketplace } = useQuery({
    ...systemFeaturesQueryOptions(),
    select: (value) => value.enable_marketplace,
  })
  const policy = autoUpgradeSettings.data?.auto_upgrade
  const autoUpgradeEnabled =
    enableMarketplace &&
    policy &&
    policy.strategy_setting !== 'disabled' &&
    (policy.upgrade_mode === 'all' ||
      (policy.upgrade_mode === 'partial' && policy.include_plugins.includes(pluginID)) ||
      (policy.upgrade_mode === 'exclude' && !policy.exclude_plugins.includes(pluginID)))
  const [organization, pluginName] = pluginID.split('/')
  const [versionMenuRequested, setVersionMenuRequested] = useState(false)
  const [info, setInfo] = useState<PluginDetail>()
  const [infoOpen, setInfoOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateSession>()
  const [updateOpen, setUpdateOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const detailQuery = useQuery(
    consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryOptions({
      input: { body: { plugin_ids: [pluginID] } },
      enabled: versionMenuRequested && canChangeVersion && !props.detail,
      retry: false,
      select: (response) =>
        response.plugins[0] ? normalizeInstalledPluginDetail(response.plugins[0]) : undefined,
    }),
  )
  const versionsQuery = useQuery(
    marketplaceQuery.pluginVersions.queryOptions({
      input:
        organization && pluginName
          ? {
              params: { organization, pluginName },
              query: { page: 1, page_size: 100 },
            }
          : skipToken,
      enabled: versionMenuRequested && canChangeVersion,
      retry: false,
    }),
  )
  const detail = props.detail ?? detailQuery.data
  const loadingVersions =
    versionMenuRequested &&
    canChangeVersion &&
    (versionsQuery.isPending ||
      (!props.detail && detailQuery.isPending) ||
      autoUpgradeSettings.isPending)
  const versionMenuOpen = versionMenuRequested && canChangeVersion && !loadingVersions
  const detailUrl =
    isFromMarketplace && organization && pluginName
      ? getMarketplaceUrl(
          `/plugins/${props.detail?.declaration.author ?? organization}/${props.detail?.declaration.name ?? pluginName}`,
          { language: locale, theme },
        )
      : isFromGitHub && detail?.meta?.repo
        ? `https://github.com/${detail.meta.repo}`
        : ''

  const handlePluginChanged = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.plugin.installedIds.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.plugin.list.installations.ids.post.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.plugin.list.latestVersions.post.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.modelProviders.get.key(),
      }),
      queryClient.invalidateQueries({ queryKey: ['marketplacePlugins'] }),
      queryClient.invalidateQueries({ queryKey: ['marketplaceCollectionPlugins'] }),
    ])
    await onUpdate?.()
  }

  const loadDetail = async () => {
    if (props.detail) return props.detail
    const response = await queryClient.query(
      consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryOptions({
        input: { body: { plugin_ids: [pluginID] } },
      }),
    )
    return response.plugins[0] ? normalizeInstalledPluginDetail(response.plugins[0]) : undefined
  }

  const handleInfo = async () => {
    try {
      const loaded = await loadDetail()
      if (loaded) {
        setInfo(loaded)
        setInfoOpen(true)
      }
    } catch {}
  }
  const handleUpdate = async () => {
    if (!canUpdatePlugin) return
    try {
      const loaded = await loadDetail()
      if (!loaded) return
      if (isFromGitHub) {
        await checkGitHubPluginUpdate(loaded, setShowUpdatePluginModal, handlePluginChanged)
      } else if (latestVersion && latestIdentifier) {
        setUpdate({
          detail: loaded,
          target: {
            version: latestVersion,
            unique_identifier: latestIdentifier,
            warnAboutAutoUpdate: false,
          },
        })
        setUpdateOpen(true)
      }
    } catch {}
  }
  const remove = useMutation(
    consoleQuery.workspaces.current.plugin.uninstall.post.mutationOptions({
      onSuccess: async (response) => {
        if (!response.success) return
        await handlePluginChanged()
        setShowDeleteConfirm(false)
      },
    }),
  )

  return (
    <>
      <Menu open={!!version && versionMenuOpen} onOpenChange={setVersionMenuRequested}>
        {!!version &&
          (canChangeVersion ? (
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="small"
                  loading={loadingVersions}
                  className="relative h-5 overflow-visible rounded-[5px] border border-divider-deep px-1.25 system-xs-medium text-text-tertiary"
                >
                  {hasNewVersion && (
                    <span className="absolute -inset-e-0.5 -top-0.5 size-1.5 rounded-xs border border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-sm" />
                  )}
                  <span>{version}</span>
                  {!loadingVersions && (
                    <span aria-hidden className="i-ri-arrow-left-right-line size-3" />
                  )}
                </Button>
              }
            />
          ) : (
            <Badge uppercase={false} text={version} hasRedCornerMark={hasNewVersion} />
          ))}
        <MenuContent
          className="max-h-[min(16rem,var(--available-height))]"
          align="start"
          aria-labelledby={versionMenuLabelId}
        >
          <MenuGroup>
            <MenuGroupLabel id={versionMenuLabelId}>
              {t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })}
            </MenuGroupLabel>
            {version && versionsQuery.data && detail && autoUpgradeSettings.data ? (
              versionsQuery.data.data.versions.map((item) => (
                <MenuItem
                  key={item.unique_identifier}
                  disabled={version === item.version}
                  onClick={() => {
                    setUpdate({
                      detail,
                      target: {
                        version: item.version,
                        unique_identifier: item.unique_identifier,
                        warnAboutAutoUpdate:
                          !!autoUpgradeEnabled && isEarlierThanVersion(item.version, version),
                      },
                    })
                    setUpdateOpen(true)
                  }}
                >
                  <span>{item.version}</span>
                  {version === item.version && (
                    <Badge className="shrink-0" variant="dimm" text="CURRENT" />
                  )}
                  <span className="ms-auto text-text-tertiary">
                    {formatDate(item.created_at, dateFormat)}
                  </span>
                </MenuItem>
              ))
            ) : (
              <MenuItem
                closeOnClick={false}
                onClick={() => {
                  if (versionsQuery.isError) void versionsQuery.refetch()
                  if (autoUpgradeSettings.isError) void autoUpgradeSettings.refetch()
                  if (!detail) void detailQuery.refetch()
                }}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </MenuItem>
            )}
          </MenuGroup>
        </MenuContent>
      </Menu>
      {source === PluginSource.debugging && (
        <Badge
          className="border-state-warning-active bg-state-warning-hover text-text-warning"
          size="xs"
          uppercase={false}
          text={t(($) => $['operation.debugConfig'], { ns: 'appDebug' })}
        />
      )}
      {canUpdatePlugin && (hasNewVersion || isFromGitHub) && (
        <Tooltip>
          <TooltipTrigger
            delay={300}
            render={
              <Button
                variant="secondary-accent"
                size="small"
                className="h-5"
                loading={detailQuery.isFetching && !versionMenuRequested}
                onClick={handleUpdate}
              >
                {t(($) => $['detailPanel.operation.update'], { ns: 'plugin' })}
              </Button>
            }
          />
          <TooltipContent>
            {t(($) => $['detailPanel.operation.updateTooltip'], { ns: 'plugin' })}
          </TooltipContent>
        </Tooltip>
      )}
      <OperationMenu
        source={source}
        onInfo={handleInfo}
        onCheckVersion={handleUpdate}
        onRemove={() => setShowDeleteConfirm(true)}
        detailUrl={detailUrl}
        align="start"
        destructiveRemove
        showCheckVersion={canUpdatePlugin}
        showRemove={canDeletePlugin}
      />
      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(open, details) => {
          if (!open && remove.isPending) details.cancel()
          else setShowDeleteConfirm(open)
        }}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $['action.delete'], { ns: 'plugin' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['action.deleteContentLeft'], { ns: 'plugin' })}
              <span className="system-md-semibold text-text-secondary">
                {props.providerLabel ?? props.detail?.declaration.label[locale]}
              </span>
              {t(($) => $['action.deleteContentRight'], { ns: 'plugin' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={remove.isPending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={remove.isPending}
              disabled={!canDeletePlugin}
              onClick={() =>
                remove.mutate({
                  body: {
                    plugin_installation_id: props.detail
                      ? props.detail.id
                      : props.summary.installation_id,
                    preserve_credentials: false,
                  },
                })
              }
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="w-120">
          {info && (
            <PluginInfoContent
              repository={info.meta?.repo}
              release={info.version}
              packageName={info.meta?.package}
            />
          )}
        </DialogContent>
      </Dialog>
      {update && (
        <MarketplaceUpdateDialog
          open={updateOpen}
          onClose={() => setUpdateOpen(false)}
          pluginId={update.detail.plugin_id}
          payload={{
            category: update.detail.declaration.category,
            originalPackageInfo: {
              id: update.detail.plugin_unique_identifier,
              payload: update.detail.declaration,
            },
            targetPackageInfo: {
              id: update.target.unique_identifier,
              version: update.target.version,
            },
          }}
          warnAboutAutoUpdate={update.target.warnAboutAutoUpdate}
          onRefresh={handlePluginChanged}
        />
      )}
    </>
  )
}

export default ProviderCardActions
