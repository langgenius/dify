'use client'

import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { PluginDetail } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Badge from '@/app/components/base/badge'
import { AuthCategory, PluginAuth } from '@/app/components/plugins/plugin-auth'
import { OperationMenu } from '@/app/components/plugins/plugin-detail-panel/operation-menu'
import { BUILTIN_TOOLS_ARRAY } from '@/app/components/plugins/readme-panel/constants'
import { useReadmePanelStore } from '@/app/components/plugins/readme-panel/store'
import { selectToolCollections } from '@/app/components/tools/utils/query-select'
import { API_PREFIX } from '@/config'
import { useGetLanguage } from '@/context/i18n'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import useTheme from '@/hooks/use-theme'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import { marketplaceQuery } from '@/service/marketplace'
import { isEarlierThanVersion } from '@/utils/semver'
import { getMarketplaceUrl } from '@/utils/var'
import Verified from '../../base/badges/verified'
import DeprecationNotice from '../../base/deprecation-notice'
import Icon from '../../card/base/card-icon'
import Description from '../../card/base/description'
import OrgInfo from '../../card/base/org-info'
import Title from '../../card/base/title'
import useReferenceSetting from '../../plugin-page/use-reference-setting'
import {
  convertUTCDaySecondsToLocalSeconds,
  timeOfDayToDayjs,
} from '../../reference-setting-modal/auto-update-setting/utils'
import { PluginCategoryEnum, PluginSource } from '../../types'
import { HeaderModals, PluginSourceBadge } from './components'
import { useDetailHeaderState, usePluginOperations } from './hooks'

type Props = Readonly<{
  canDeletePlugin?: boolean
  canUpdatePlugin?: boolean
  detail: PluginDetail
  isReadmeView?: boolean
  onHide?: () => void
  onUpdate?: (isDelete?: boolean) => void
}>

const getIconSrc = (
  icon: string | undefined,
  iconDark: string | undefined,
  theme: string,
  tenantId: string,
): string => {
  const iconFileName = theme === 'dark' && iconDark ? iconDark : icon
  if (!iconFileName) return ''
  return iconFileName.startsWith('http')
    ? iconFileName
    : `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenantId}&filename=${iconFileName}`
}

const getDetailUrl = (
  source: PluginSource,
  meta: PluginDetail['meta'],
  author: string,
  name: string,
  locale: string,
  theme: string,
): string => {
  if (source === PluginSource.github) {
    const repo = meta?.repo
    if (!repo) return ''
    return `https://github.com/${repo}`
  }
  if (source === PluginSource.marketplace)
    return getMarketplaceUrl(`/plugins/${author}/${name}`, { language: locale, theme })
  return ''
}

const DetailHeader = ({
  canDeletePlugin = true,
  canUpdatePlugin = true,
  detail,
  isReadmeView = false,
  onHide,
  onUpdate,
}: Props) => {
  const { t } = useTranslation(['common', 'plugin', 'appLog'])
  const versionMenuLabelId = useId()
  const { formatDate } = useTimestamp()
  const dateFormat = t(($) => $.dateTimeFormat, { ns: 'appLog' }).split(' ')[0]!
  const openReadmePanel = useReadmePanelStore((s) => s.openReadmePanel)
  const { data: timezone } = useQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.timezone ?? undefined,
  })
  const { theme } = useTheme()
  const locale = useGetLanguage()
  const currentLocale = useLocale()
  const detailCategory = detail.declaration?.category ?? PluginCategoryEnum.tool
  const { referenceSetting } = useReferenceSetting(detailCategory)

  const {
    source,
    tenant_id,
    version,
    meta,
    plugin_id,
    status,
    deprecated_reason,
    alternative_plugin_id,
  } = detail

  const { author, category, name, label, description, icon, icon_dark, verified, tool } =
    detail.declaration || detail

  const {
    modalStates,
    versionPicker,
    hasNewVersion,
    isAutoUpgradeEnabled,
    autoUpgradeSettings,
    isFromGitHub,
    isFromMarketplace,
  } = useDetailHeaderState(detail)

  const { handleUpdate, handleUpdatedFromMarketplace, handleDelete, deleting } =
    usePluginOperations({
      detail,
      modalStates,
      canDeletePlugin,
      canUpdatePlugin,
      onUpdate,
    })

  const [organization, pluginName] = plugin_id.split('/')
  const versionsQuery = useQuery(
    marketplaceQuery.pluginVersions.queryOptions({
      input:
        organization && pluginName
          ? { params: { organization, pluginName }, query: { page: 1, page_size: 100 } }
          : skipToken,
      enabled: versionPicker.isShow && canUpdatePlugin && isFromMarketplace && !isReadmeView,
      retry: false,
    }),
  )
  const loadingVersions =
    versionPicker.isShow && (versionsQuery.isPending || autoUpgradeSettings.isPending)

  const isTool = category === PluginCategoryEnum.tool
  const providerBriefInfo = tool?.identity
  const providerKey = `${plugin_id}/${providerBriefInfo?.name}`
  const { data: collectionList = [] } = useQuery(
    consoleQuery.workspaces.current.toolProviders.get.queryOptions({
      input: { query: {} },
      enabled: isTool,
      select: selectToolCollections,
    }),
  )
  const provider = useMemo(() => {
    return collectionList.find((collection) => collection.name === providerKey)
  }, [collectionList, providerKey])

  const iconSrc = getIconSrc(icon, icon_dark, theme, tenant_id)
  const detailUrl = getDetailUrl(source, meta, author, name, currentLocale, theme)
  const canViewReadme =
    !!detail.plugin_unique_identifier && !BUILTIN_TOOLS_ARRAY.includes(detail.id)
  const { auto_upgrade: autoUpgradeInfo } = referenceSetting || {}
  const handleViewReadme = useCallback(() => {
    openReadmePanel({
      detail,
      presentation: 'drawer',
    })
  }, [detail, openReadmePanel])

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

  return (
    <div
      className={cn(
        'shrink-0 border-b border-divider-subtle bg-components-panel-bg p-4 pb-3',
        isReadmeView && 'border-b-0 bg-transparent p-0',
      )}
    >
      <div className="flex">
        {/* Plugin Icon */}
        <div
          className={cn(
            'overflow-hidden rounded-xl border border-components-panel-border-subtle',
            isReadmeView && 'bg-components-panel-bg',
          )}
        >
          <Icon src={iconSrc} />
        </div>

        {/* Plugin Info */}
        <div className="ml-3 w-0 grow">
          {/* Title Row */}
          <div className="flex h-5 items-center">
            <Title title={label[locale]} />
            {verified && !isReadmeView && (
              <Verified
                className="ml-0.5 size-4"
                text={t(($) => $['marketplace.verifiedTip'], { ns: 'plugin' })}
              />
            )}

            {/* Version Picker */}
            <Menu
              open={
                !!version &&
                versionPicker.isShow &&
                canUpdatePlugin &&
                isFromMarketplace &&
                !isReadmeView &&
                !loadingVersions
              }
              onOpenChange={versionPicker.setIsShow}
            >
              {!!version && (
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={!canUpdatePlugin || !isFromMarketplace || isReadmeView}
                      loading={loadingVersions}
                      className="relative mx-1 h-5 overflow-visible rounded-[5px] border border-divider-deep px-1.25 system-xs-medium text-text-tertiary"
                    >
                      {hasNewVersion && (
                        <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-xs border border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-sm" />
                      )}
                      <span>{isFromGitHub ? (meta?.version ?? version) : version}</span>
                      {canUpdatePlugin &&
                        isFromMarketplace &&
                        !isReadmeView &&
                        !loadingVersions && (
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
                        disabled={version === item.version}
                        onClick={() => handleVersionSelect(item)}
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
                      }}
                    >
                      {t(($) => $['operation.retry'], { ns: 'common' })}
                    </MenuItem>
                  )}
                </MenuGroup>
              </MenuContent>
            </Menu>

            {/* Auto Update Badge */}
            {isAutoUpgradeEnabled && !isReadmeView && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div>
                      <Badge className="mr-1 cursor-pointer px-1">
                        <span
                          aria-hidden
                          className="i-custom-vender-system-auto-update-line size-3"
                        />
                      </Badge>
                    </div>
                  }
                />
                <TooltipContent>
                  {t(($) => $['autoUpdate.nextUpdateTime'], {
                    ns: 'plugin',
                    time: timeOfDayToDayjs(
                      convertUTCDaySecondsToLocalSeconds(
                        autoUpgradeInfo?.upgrade_time_of_day || 0,
                        timezone!,
                      ),
                    ).format('hh:mm A'),
                  })}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Update Button */}
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
          </div>

          {/* Org Info Row */}
          <div className="mb-1 flex h-4 items-center justify-between">
            <div className="mt-0.5 flex items-center">
              <OrgInfo
                packageNameClassName="w-auto"
                orgName={author}
                packageName={name?.includes('/') ? name.split('/').pop() || '' : name}
              />
              {!!source && <PluginSourceBadge source={source} />}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {!isReadmeView && (
          <div className="flex gap-1">
            <OperationMenu
              source={source}
              onInfo={modalStates.showPluginInfo}
              onCheckVersion={handleUpdate}
              onRemove={modalStates.showDeleteConfirm}
              onViewReadme={canViewReadme ? handleViewReadme : undefined}
              detailUrl={detailUrl}
              showCheckVersion={canUpdatePlugin}
              showRemove={canDeletePlugin}
            />
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              onClick={onHide}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          </div>
        )}
      </div>

      {/* Deprecation Notice */}
      {isFromMarketplace && (
        <DeprecationNotice
          status={status}
          deprecatedReason={deprecated_reason}
          alternativePluginId={alternative_plugin_id}
          alternativePluginURL={getMarketplaceUrl(`/plugins/${alternative_plugin_id}`, {
            language: currentLocale,
            theme,
          })}
          className="mt-3"
        />
      )}

      {/* Description */}
      {!isReadmeView && (
        <Description
          className="mt-3 mb-2 h-auto"
          text={description[locale]}
          descriptionLineRows={2}
        />
      )}

      {/* Plugin Auth for Tools */}
      {category === PluginCategoryEnum.tool && !isReadmeView && (
        <PluginAuth
          pluginPayload={{
            provider: provider?.name || '',
            category: AuthCategory.tool,
            providerType: provider?.type,
            detail,
          }}
        />
      )}

      {/* Modals */}
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

export default DetailHeader
