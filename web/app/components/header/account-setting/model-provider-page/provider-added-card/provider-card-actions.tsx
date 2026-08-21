import type { FC } from 'react'
import type { ModelProviderPluginSummary } from '../index'
import type { PluginDetail } from '@/app/components/plugins/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQueryClient } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { HeaderModals } from '@/app/components/plugins/plugin-detail-panel/detail-header/components'
import {
  useDetailHeaderState,
  usePluginOperations,
} from '@/app/components/plugins/plugin-detail-panel/detail-header/hooks'
import { OperationDropdown } from '@/app/components/plugins/plugin-detail-panel/operation-dropdown'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { PluginSource } from '@/app/components/plugins/types'
import PluginVersionPicker from '@/app/components/plugins/update-plugin/plugin-version-picker'
import { useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { consoleQuery } from '@/service/client'
import { uninstallPlugin } from '@/service/plugins'
import { commonQueryKeys } from '@/service/use-common'
import { normalizeInstalledPluginDetail } from '@/service/use-plugins'
import { getMarketplaceUrl } from '@/utils/var'

type DetailAction = 'version' | 'latest' | 'info' | 'check'

type Props =
  | Readonly<{
      summary: ModelProviderPluginSummary
      providerLabel: string
      onUpdate?: () => void
      detail?: never
    }>
  | Readonly<{
      detail: PluginDetail
      onUpdate?: () => void
      summary?: never
      providerLabel?: never
    }>

const pluginSourceMap: Record<ModelProviderPluginSummary['source'], PluginSource> = {
  github: PluginSource.github,
  marketplace: PluginSource.marketplace,
  package: PluginSource.local,
  remote: PluginSource.debugging,
}

const ProviderCardActions: FC<Props> = (props) => {
  const queryClient = useQueryClient()
  const { onUpdate } = props
  const handlePluginChanged = useCallback(async () => {
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
      queryClient.invalidateQueries({ queryKey: commonQueryKeys.modelProviderDetails }),
      queryClient.invalidateQueries({ queryKey: ['marketplacePlugins'] }),
      queryClient.invalidateQueries({ queryKey: ['marketplaceCollectionPlugins'] }),
    ])
    onUpdate?.()
  }, [onUpdate, queryClient])

  if (props.detail) {
    return (
      <LoadedProviderCardActions
        detail={props.detail}
        onInitialActionHandled={() => {}}
        onUpdate={handlePluginChanged}
      />
    )
  }

  return <SummaryProviderCardActions {...props} onUpdate={handlePluginChanged} />
}

type SummaryProps = Extract<Props, { summary: ModelProviderPluginSummary }>

function SummaryProviderCardActions({ summary, providerLabel, onUpdate }: SummaryProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { canDeletePlugin, canUpdatePlugin } = usePluginSettingsAccess()
  const [detail, setDetail] = useState<PluginDetail>()
  const [detailAction, setDetailAction] = useState<DetailAction>()
  const [loadingAction, setLoadingAction] = useState<DetailAction>()
  const [showDeleteConfirm, { setTrue: openDeleteConfirm, setFalse: closeDeleteConfirm }] =
    useBoolean(false)
  const [deleting, { setTrue: startDeleting, setFalse: finishDeleting }] = useBoolean(false)
  const source = pluginSourceMap[summary.source]
  const isFromMarketplace = source === PluginSource.marketplace
  const isFromGitHub = source === PluginSource.github
  const canChangeVersion = canUpdatePlugin && isFromMarketplace
  const hasNewVersion =
    isFromMarketplace && !!summary.latestVersion && summary.latestVersion !== summary.version
  const [author, name] = summary.plugin_id.split('/')
  const detailUrl =
    isFromMarketplace && author && name ? getMarketplaceUrl(`/plugins/${author}/${name}`) : ''

  const loadDetail = async (action: DetailAction) => {
    setLoadingAction(action)
    try {
      const response = await queryClient.fetchQuery(
        consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryOptions({
          input: { body: { plugin_ids: [summary.plugin_id] } },
        }),
      )
      const nextDetail = response.plugins[0]
      if (!nextDetail) return
      const normalizedDetail = normalizeInstalledPluginDetail(nextDetail)
      const detailWithLatestVersion =
        isFromMarketplace && summary.latestVersion && summary.latestUniqueIdentifier
          ? {
              ...normalizedDetail,
              latest_version: summary.latestVersion,
              latest_unique_identifier: summary.latestUniqueIdentifier,
            }
          : normalizedDetail
      setDetail(detailWithLatestVersion)
      setDetailAction(action)
    } catch {
    } finally {
      setLoadingAction(undefined)
    }
  }

  const handleDelete = async () => {
    startDeleting()
    try {
      const response = await uninstallPlugin(summary.installation_id)
      if (!response.success) return
      closeDeleteConfirm()
      await onUpdate?.()
    } finally {
      finishDeleting()
    }
  }

  if (detail) {
    return (
      <LoadedProviderCardActions
        detail={detail}
        initialAction={detailAction}
        onInitialActionHandled={() => setDetailAction(undefined)}
        onUpdate={onUpdate}
      />
    )
  }

  return (
    <>
      {!!summary.version && (
        <>
          {canChangeVersion ? (
            <button
              type="button"
              className="rounded-md border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              aria-label={summary.version}
              disabled={loadingAction === 'version'}
              onClick={() => loadDetail('version')}
            >
              <Badge
                className="cursor-pointer hover:bg-state-base-hover"
                uppercase={false}
                text={
                  <>
                    <span>{summary.version}</span>
                    <span className="ml-1 i-ri-arrow-left-right-line size-3" />
                  </>
                }
                hasRedCornerMark={hasNewVersion}
              />
            </button>
          ) : (
            <Badge
              uppercase={false}
              text={<span>{summary.version}</span>}
              hasRedCornerMark={hasNewVersion}
            />
          )}
          {source === PluginSource.debugging && (
            <Badge
              className="border-state-warning-active bg-state-warning-hover text-text-warning"
              size="xs"
              uppercase={false}
              text={t(($) => $['operation.debugConfig'], { ns: 'appDebug' })}
            />
          )}
        </>
      )}

      {canUpdatePlugin && (hasNewVersion || isFromGitHub) && (
        <Tooltip>
          <TooltipTrigger
            delay={300}
            render={
              <Button
                variant="secondary-accent"
                size="small"
                className="h-5!"
                loading={loadingAction === 'latest'}
                onClick={() => loadDetail('latest')}
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

      <OperationDropdown
        source={source}
        onInfo={() => loadDetail('info')}
        onCheckVersion={() => loadDetail('check')}
        onRemove={openDeleteConfirm}
        detailUrl={detailUrl}
        placement="bottom-start"
        destructiveRemove
        showCheckVersion={canUpdatePlugin}
        showRemove={canDeletePlugin}
      />

      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) closeDeleteConfirm()
        }}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['action.delete'], { ns: 'plugin' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['action.deleteContentLeft'], { ns: 'plugin' })}
              <span className="system-md-semibold text-text-secondary">{providerLabel}</span>
              {t(($) => $['action.deleteContentRight'], { ns: 'plugin' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={deleting}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={deleting} disabled={deleting} onClick={handleDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type LoadedProps = Readonly<{
  detail: PluginDetail
  initialAction?: DetailAction
  onInitialActionHandled: () => void
  onUpdate?: () => void
}>

function LoadedProviderCardActions({
  detail,
  initialAction,
  onInitialActionHandled,
  onUpdate,
}: LoadedProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const locale = useLocale()
  const { canDeletePlugin, canUpdatePlugin } = usePluginSettingsAccess()
  const { source, version, latest_version, latest_unique_identifier, meta } = detail
  const author = detail.declaration?.author ?? ''
  const name = detail.declaration?.name ?? detail.name
  const isDebuggingPlugin = source === PluginSource.debugging
  const {
    modalStates,
    versionPicker,
    hasNewVersion,
    isAutoUpgradeEnabled,
    isFromMarketplace,
    isFromGitHub,
  } = useDetailHeaderState(detail)
  const { handleUpdate, handleUpdatedFromMarketplace, handleDelete } = usePluginOperations({
    detail,
    modalStates,
    versionPicker,
    isFromMarketplace,
    canDeletePlugin,
    canUpdatePlugin,
    onUpdate,
  })

  const handleVersionSelect = (state: {
    version: string
    unique_identifier: string
    isDowngrade?: boolean
  }) => {
    versionPicker.setTargetVersion(state)
    handleUpdate(state.isDowngrade)
  }

  const handleTriggerLatestUpdate = useCallback(() => {
    if (isFromMarketplace) {
      if (!latest_unique_identifier) return
      versionPicker.setTargetVersion({
        version: latest_version,
        unique_identifier: latest_unique_identifier,
      })
    }
    handleUpdate()
  }, [handleUpdate, isFromMarketplace, latest_unique_identifier, latest_version, versionPicker])

  const pendingInitialActionRef = useRef(initialAction)
  useEffect(() => {
    const pendingAction = pendingInitialActionRef.current
    if (!pendingAction) return
    pendingInitialActionRef.current = undefined
    if (pendingAction === 'version') versionPicker.setIsShow(true)
    if (pendingAction === 'latest') handleTriggerLatestUpdate()
    if (pendingAction === 'info') modalStates.showPluginInfo()
    if (pendingAction === 'check') handleUpdate()
    onInitialActionHandled()
  }, [handleTriggerLatestUpdate, handleUpdate, modalStates, onInitialActionHandled, versionPicker])

  const detailUrl = useMemo(() => {
    if (source === PluginSource.github) return meta?.repo ? `https://github.com/${meta.repo}` : ''
    if (source === PluginSource.marketplace)
      return getMarketplaceUrl(`/plugins/${author}/${name}`, { language: locale, theme })
    return ''
  }, [source, meta?.repo, author, name, locale, theme])

  return (
    <>
      {!!version && (
        <>
          <PluginVersionPicker
            disabled={!isFromMarketplace || !canUpdatePlugin}
            isShow={versionPicker.isShow}
            onShowChange={versionPicker.setIsShow}
            pluginID={detail.plugin_id}
            currentVersion={version}
            onSelect={handleVersionSelect}
            sideOffset={4}
            alignOffset={0}
            trigger={() => (
              <Badge
                className={cn(
                  canUpdatePlugin &&
                    isFromMarketplace &&
                    'cursor-pointer hover:bg-state-base-hover',
                )}
                uppercase={false}
                text={
                  <>
                    <span>{version}</span>
                    {canUpdatePlugin && isFromMarketplace && (
                      <span className="ml-1 i-ri-arrow-left-right-line size-3" />
                    )}
                  </>
                }
                hasRedCornerMark={hasNewVersion}
              />
            )}
          />
          {isDebuggingPlugin && (
            <Badge
              className="border-state-warning-active bg-state-warning-hover text-text-warning"
              size="xs"
              uppercase={false}
              text={t(($) => $['operation.debugConfig'], { ns: 'appDebug' })}
            />
          )}
        </>
      )}

      {canUpdatePlugin && (hasNewVersion || isFromGitHub) && (
        <Tooltip>
          <TooltipTrigger
            delay={300}
            render={
              <Button
                variant="secondary-accent"
                size="small"
                className="h-5!"
                onClick={handleTriggerLatestUpdate}
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

      <OperationDropdown
        source={source}
        onInfo={modalStates.showPluginInfo}
        onCheckVersion={() => handleUpdate()}
        onRemove={modalStates.showDeleteConfirm}
        detailUrl={detailUrl}
        placement="bottom-start"
        destructiveRemove
        showCheckVersion={canUpdatePlugin}
        showRemove={canDeletePlugin}
      />

      <HeaderModals
        detail={detail}
        modalStates={modalStates}
        targetVersion={versionPicker.targetVersion}
        isDowngrade={versionPicker.isDowngrade}
        isAutoUpgradeEnabled={isAutoUpgradeEnabled}
        onUpdatedFromMarketplace={handleUpdatedFromMarketplace}
        onDelete={handleDelete}
      />
    </>
  )
}

export default ProviderCardActions
