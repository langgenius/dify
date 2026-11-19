'use client'

import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { PluginDetail } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { HeaderModals } from '@/app/components/plugins/plugin-detail-panel/detail-header/components'
import {
  useDetailHeaderState,
  usePluginOperations,
} from '@/app/components/plugins/plugin-detail-panel/detail-header/hooks'
import { OperationMenu } from '@/app/components/plugins/plugin-detail-panel/operation-menu'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { useReadmePanelStore } from '@/app/components/plugins/readme-panel/store'
import { useMarketplace, useMarketplacePluginVersions } from '@/features/marketplace/client'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import useTimestamp from '@/hooks/use-timestamp'
import { isEarlierThanVersion } from '@/utils/semver'

type Props = {
  detail: PluginDetail
  onUpdate?: (isDelete?: boolean) => void
}

const DataSourcePluginActions = ({ detail, onUpdate }: Props) => {
  const { t } = useTranslation(['common', 'plugin', 'appLog'])
  const versionMenuLabelId = useId()
  const { formatDate } = useTimestamp()
  const dateFormat = t(($) => $.dateTimeFormat, { ns: 'appLog' }).split(' ')[0]!
  const renderI18nObject = useRenderI18nObject()
  const readmeTriggerId = useId()
  const openReadmePanel = useReadmePanelStore((s) => s.openReadmePanel)
  const { canDeletePlugin, canUpdatePlugin } = usePluginSettingsAccess()
  const detailHeaderState = useDetailHeaderState(detail)
  const marketplace = useMarketplace()
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

  const canChangeVersion = canUpdatePlugin && isFromMarketplace && marketplace !== null
  const versionsQuery = useMarketplacePluginVersions(
    detail.plugin_id,
    versionPicker.isShow && canChangeVersion,
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
      <Menu
        open={!!displayVersion && versionPicker.isShow && canChangeVersion && !loadingVersions}
        onOpenChange={versionPicker.setIsShow}
      >
        {!!displayVersion && (
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="small"
                disabled={!canChangeVersion}
                loading={loadingVersions}
                aria-label={`${t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })} ${pluginLabel} ${displayVersion}`}
                className="relative h-5 overflow-visible rounded-[5px] border border-divider-deep px-1.5 system-xs-medium text-text-tertiary"
              >
                {hasNewVersion && (
                  <span className="absolute -inset-e-0.5 -top-0.5 size-1.5 rounded-xs border border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-sm" />
                )}
                <span>{displayVersion}</span>
                {canChangeVersion && !loadingVersions && (
                  <span aria-hidden className="i-ri-arrow-left-right-line size-3" />
                )}
              </Button>
            }
          />
        )}
        <MenuContent
          className="max-h-[min(16rem,var(--available-height))]"
          align="start"
          aria-labelledby={versionMenuLabelId}
        >
          <MenuGroup>
            <MenuGroupLabel id={versionMenuLabelId}>
              {t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })}
            </MenuGroupLabel>
            {versionsQuery.data && autoUpgradeSettings.data ? (
              versionsQuery.data.data.versions.map((item) => (
                <MenuItem
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
                </MenuItem>
              ))
            ) : (
              <MenuItem
                closeOnClick={false}
                onClick={() => {
                  if (versionsQuery.isError) void versionsQuery.refetch()
                  if (autoUpgradeSettings.isError) void autoUpgradeSettings.refetch()
                }}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </MenuItem>
            )}
          </MenuGroup>
        </MenuContent>
      </Menu>
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
      <OperationMenu
        triggerAriaLabel={t(($) => $['operation.moreActionsFor'], {
          ns: 'common',
          name: pluginLabel,
        })}
        source={detail.source}
        onInfo={modalStates.showPluginInfo}
        onCheckVersion={handleUpdate}
        onRemove={modalStates.showDeleteConfirm}
        onViewReadme={detail.plugin_unique_identifier ? handleViewReadme : undefined}
        marketplacePlugin={{ org: detail.declaration.author, name: detail.declaration.name }}
        repo={detail.meta?.repo}
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
