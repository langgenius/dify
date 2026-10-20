'use client'

import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { PluginDetail } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useQuery } from '@tanstack/react-query'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Badge from '@/app/components/base/badge'
import { HeaderModals } from '@/app/components/plugins/plugin-detail-panel/detail-header/components'
import {
  useDetailHeaderState,
  usePluginOperations,
} from '@/app/components/plugins/plugin-detail-panel/detail-header/hooks'
import { OperationDropdown } from '@/app/components/plugins/plugin-detail-panel/operation-dropdown'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { useReadmePanelStore } from '@/app/components/plugins/readme-panel/store'
import { PluginSource } from '@/app/components/plugins/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import useTheme from '@/hooks/use-theme'
import useTimestamp from '@/hooks/use-timestamp'
import { marketplaceQuery } from '@/service/marketplace'
import { isEarlierThanVersion } from '@/utils/semver'
import { getMarketplaceUrl } from '@/utils/var'

type Props = {
  detail: PluginDetail
  onUpdate?: (isDelete?: boolean) => void
}

const getDetailUrl = (detail: PluginDetail, locale: string, theme: string) => {
  const { source, meta } = detail
  const { author, name } = detail.declaration || detail

  if (source === PluginSource.github) return meta?.repo ? `https://github.com/${meta.repo}` : ''

  if (source === PluginSource.marketplace)
    return getMarketplaceUrl(`/plugins/${author}/${name}`, { language: locale, theme })

  return ''
}

const DataSourcePluginActions = ({ detail, onUpdate }: Props) => {
  const { t } = useTranslation(['common', 'plugin', 'appLog'])
  const versionMenuLabelId = useId()
  const { formatDate } = useTimestamp()
  const dateFormat = t(($) => $.dateTimeFormat, { ns: 'appLog' }).split(' ')[0]!
  const { theme } = useTheme()
  const locale = useLocale()
  const renderI18nObject = useRenderI18nObject()
  const readmeTriggerId = useId()
  const openReadmePanel = useReadmePanelStore((s) => s.openReadmePanel)
  const { canDeletePlugin, canUpdatePlugin } = usePluginSettingsAccess()
  const detailHeaderState = useDetailHeaderState(detail)
  const {
    modalStates,
    versionPicker,
    hasNewVersion,
    isAutoUpgradeEnabled,
    autoUpgradeSettings,
    isFromGitHub,
    isFromMarketplace,
  } = detailHeaderState
  const { handleUpdate, handleUpdatedFromMarketplace, handleDelete, deleting } =
    usePluginOperations({
      detail,
      modalStates,
      canDeletePlugin,
      canUpdatePlugin,
      onUpdate,
    })
  const displayVersion = isFromGitHub ? (detail.meta?.version ?? detail.version) : detail.version
  const pluginLabel = renderI18nObject(detail.declaration.label) || detail.name

  const [organization, pluginName] = detail.plugin_id.split('/')
  const versionsQuery = useQuery(
    marketplaceQuery.pluginVersions.queryOptions({
      input:
        organization && pluginName
          ? { params: { organization, pluginName }, query: { page: 1, page_size: 100 } }
          : skipToken,
      enabled: versionPicker.isShow && canUpdatePlugin && isFromMarketplace,
      retry: false,
    }),
  )
  const loadingVersions =
    versionPicker.isShow && (versionsQuery.isPending || autoUpgradeSettings.isPending)

  const handleVersionSelect = (item: PluginVersionsResponse['data']['versions'][number]) => {
    const isDowngrade = isEarlierThanVersion(item.version, detail.version)
    versionPicker.setTargetVersion({
      ...item,
      plugin: detail,
      warnAboutAutoUpdate: isDowngrade && isAutoUpgradeEnabled,
    })
    handleUpdate()
  }

  const handleTriggerLatestUpdate = () => {
    if (isFromMarketplace) {
      if (!detail.latest_version || !detail.latest_unique_identifier) return
      versionPicker.setTargetVersion({
        plugin: detail,
        version: detail.latest_version,
        unique_identifier: detail.latest_unique_identifier,
      })
    }
    handleUpdate()
  }
  const handleViewReadme = () => {
    openReadmePanel({
      detail,
      triggerId: readmeTriggerId,
    })
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <DropdownMenu
        open={
          !!displayVersion &&
          versionPicker.isShow &&
          canUpdatePlugin &&
          isFromMarketplace &&
          !loadingVersions
        }
        onOpenChange={versionPicker.setIsShow}
      >
        {!!displayVersion && (
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="small"
                disabled={!canUpdatePlugin || !isFromMarketplace}
                loading={loadingVersions}
                aria-label={`${t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })} ${pluginLabel} ${displayVersion}`}
                className="relative h-5 overflow-visible rounded-[5px] border border-divider-deep px-1.5 system-xs-medium text-text-tertiary"
              >
                {hasNewVersion && (
                  <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-xs border border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-sm" />
                )}
                <span>{displayVersion}</span>
                {canUpdatePlugin && isFromMarketplace && !loadingVersions && (
                  <span aria-hidden className="i-ri-arrow-left-right-line size-3" />
                )}
              </Button>
            }
          />
        )}
        <DropdownMenuContent
          className="max-h-[min(16rem,var(--available-height))]"
          placement="bottom-start"
          aria-labelledby={versionMenuLabelId}
        >
          <DropdownMenuGroup>
            <DropdownMenuGroupLabel id={versionMenuLabelId}>
              {t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })}
            </DropdownMenuGroupLabel>
            {versionsQuery.data && autoUpgradeSettings.data ? (
              versionsQuery.data.data.versions.map((item) => (
                <DropdownMenuItem
                  key={item.unique_identifier}
                  disabled={detail.version === item.version}
                  onClick={() => handleVersionSelect(item)}
                >
                  <span>{item.version}</span>
                  {detail.version === item.version && (
                    <Badge className="shrink-0" variant="dimm" text="CURRENT" />
                  )}
                  <span className="ms-auto text-text-tertiary">
                    {formatDate(item.created_at, dateFormat)}
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => {
                  if (versionsQuery.isError) void versionsQuery.refetch()
                  if (autoUpgradeSettings.isError) void autoUpgradeSettings.refetch()
                }}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {canUpdatePlugin && (hasNewVersion || isFromGitHub) && (
        <Tooltip>
          <TooltipTrigger
            delay={300}
            render={
              <Button
                variant="secondary-accent"
                size="small"
                className="h-5 rounded-md px-1.5 py-0 system-xs-medium"
                onClick={handleTriggerLatestUpdate}
                aria-label={`${t(($) => $['detailPanel.operation.update'], { ns: 'plugin' })} ${pluginLabel}`}
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
        triggerAriaLabel={t(($) => $['operation.moreActionsFor'], {
          ns: 'common',
          name: pluginLabel,
        })}
        source={detail.source}
        onInfo={modalStates.showPluginInfo}
        onCheckVersion={handleUpdate}
        onRemove={modalStates.showDeleteConfirm}
        onViewReadme={detail.plugin_unique_identifier ? handleViewReadme : undefined}
        detailUrl={getDetailUrl(detail, locale, theme || 'light')}
        triggerSize="xs"
        showCheckVersion={canUpdatePlugin}
        showRemove={canDeletePlugin}
      />
      <HeaderModals
        detail={detail}
        modalStates={modalStates}
        targetVersion={versionPicker.targetVersion}
        onUpdatedFromMarketplace={handleUpdatedFromMarketplace}
        onDelete={handleDelete}
        deleting={deleting}
      />
    </div>
  )
}

export default memo(DataSourcePluginActions)
