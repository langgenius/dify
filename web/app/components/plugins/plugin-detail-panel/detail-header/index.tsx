'use client'

import type { PluginDetail } from '../../types'
import {
  RiArrowLeftRightLine,
  RiCloseLine,
} from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { AuthCategory, PluginAuth } from '@/app/components/plugins/plugin-auth'
import OperationDropdown from '@/app/components/plugins/plugin-detail-panel/operation-dropdown'
import PluginVersionPicker from '@/app/components/plugins/update-plugin/plugin-version-picker'
import { API_PREFIX } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useGetLanguage, useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { useAllToolProviders } from '@/service/use-tools'
import { cn } from '@/utils/classnames'
import { getMarketplaceUrl } from '@/utils/var'
import { AutoUpdateLine } from '../../../base/icons/src/vender/system'
import Verified from '../../base/badges/verified'
import DeprecationNotice from '../../base/deprecation-notice'
import Icon from '../../card/base/card-icon'
import Description from '../../card/base/description'
import OrgInfo from '../../card/base/org-info'
import Title from '../../card/base/title'
import useReferenceSetting from '../../plugin-page/use-reference-setting'
import { convertUTCDaySecondsToLocalSeconds, timeOfDayToDayjs } from '../../reference-setting-modal/auto-update-setting/utils'
import { PluginCategoryEnum, PluginSource } from '../../types'
import { HeaderModals, PluginSourceBadge } from './components'
import { useDetailHeaderState, usePluginOperations } from './hooks'

type Props = {
  detail: PluginDetail
  isReadmeView?: boolean
  onHide?: () => void
  onUpdate?: (isDelete?: boolean) => void
}

const getIconSrc = (icon: string | undefined, iconDark: string | undefined, theme: string, tenantId: string): string => {
  const iconFileName = theme === 'dark' && iconDark ? iconDark : icon
  if (!iconFileName)
    return ''
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
    if (!repo)
      return ''
    return `https://github.com/${repo}`
  }
  if (source === PluginSource.marketplace)
    return getMarketplaceUrl(`/plugins/${author}/${name}`, { language: locale, theme })
  return ''
}

const DetailHeader = ({
  detail,
  isReadmeView = false,
  onHide,
  onUpdate,
}: Props) => {
  const { t } = useTranslation()
  const { userProfile: { timezone } } = useAppContext()
  const { theme } = useTheme()
  const locale = useGetLanguage()
  const currentLocale = useLocale()
  const { referenceSetting } = useReferenceSetting()

  const {
    source,
    tenant_id,
    version,
    latest_version,
    latest_unique_identifier,
    meta,
    plugin_id,
    status,
    deprecated_reason,
    alternative_plugin_id,
  } = detail

  const { author, category, name, label, description, icon, icon_dark, verified, tool } = detail.declaration || detail

  const {
    modalStates,
    versionPicker,
    hasNewVersion,
    isAutoUpgradeEnabled,
    isFromGitHub,
    isFromMarketplace,
  } = useDetailHeaderState(detail)

  const {
    handleUpdate,
    handleUpdatedFromMarketplace,
    handleDelete,
  } = usePluginOperations({
    detail,
    modalStates,
    versionPicker,
    isFromMarketplace,
    onUpdate,
  })

  const isTool = category === PluginCategoryEnum.tool
  const providerBriefInfo = tool?.identity
  const providerKey = `${plugin_id}/${providerBriefInfo?.name}`
  const { data: collectionList = [] } = useAllToolProviders(isTool)
  const provider = useMemo(() => {
    return collectionList.find(collection => collection.name === providerKey)
  }, [collectionList, providerKey])

  const iconSrc = getIconSrc(icon, icon_dark, theme, tenant_id)
  const detailUrl = getDetailUrl(source, meta, author, name, currentLocale, theme)
  const { auto_upgrade: autoUpgradeInfo } = referenceSetting || {}

  const handleVersionSelect = (state: { version: string, unique_identifier: string, isDowngrade?: boolean }) => {
    versionPicker.setTargetVersion(state)
    handleUpdate(state.isDowngrade)
  }

  const handleTriggerLatestUpdate = () => {
    if (isFromMarketplace) {
      versionPicker.setTargetVersion({
        version: latest_version,
        unique_identifier: latest_unique_identifier,
      })
    }
    handleUpdate()
  }

  return (
    <div className={cn('shrink-0 border-b border-divider-subtle bg-components-panel-bg p-4 pb-3', isReadmeView && 'border-b-0 bg-transparent p-0')}>
      <div className="flex">
        {/* Plugin Icon */}
        <div className={cn('overflow-hidden rounded-xl border border-components-panel-border-subtle', isReadmeView && 'bg-components-panel-bg')}>
          <Icon src={iconSrc} />
        </div>

        {/* Plugin Info */}
        <div className="ml-3 w-0 grow">
          {/* Title Row */}
          <div className="flex h-5 items-center">
            <Title title={label[locale]} />
            {verified && !isReadmeView && <Verified className="ml-0.5 h-4 w-4" text={t('marketplace.verifiedTip', { ns: 'plugin' })} />}

            {/* Version Picker */}
            {!!version && (
              <PluginVersionPicker
                disabled={!isFromMarketplace || isReadmeView}
                isShow={versionPicker.isShow}
                onShowChange={versionPicker.setIsShow}
                pluginID={plugin_id}
                currentVersion={version}
                onSelect={handleVersionSelect}
                trigger={(
                  <Badge
                    className={cn(
                      'mx-1',
                      versionPicker.isShow && 'bg-state-base-hover',
                      (versionPicker.isShow || isFromMarketplace) && 'hover:bg-state-base-hover',
                    )}
                    uppercase={false}
                    text={(
                      <>
                        <div>{isFromGitHub ? (meta?.version ?? version ?? '') : version}</div>
                        {isFromMarketplace && !isReadmeView && <RiArrowLeftRightLine className="ml-1 h-3 w-3 text-text-tertiary" />}
                      </>
                    )}
                    hasRedCornerMark={hasNewVersion}
                  />
                )}
              />
            )}

            {/* Auto Update Badge */}
            {isAutoUpgradeEnabled && !isReadmeView && (
              <Tooltip popupContent={t('autoUpdate.nextUpdateTime', { ns: 'plugin', time: timeOfDayToDayjs(convertUTCDaySecondsToLocalSeconds(autoUpgradeInfo?.upgrade_time_of_day || 0, timezone!)).format('hh:mm A') })}>
                <div>
                  <Badge className="mr-1 cursor-pointer px-1">
                    <AutoUpdateLine className="size-3" />
                  </Badge>
                </div>
              </Tooltip>
            )}

            {/* Update Button */}
            {(hasNewVersion || isFromGitHub) && (
              <Button
                variant="secondary-accent"
                size="small"
                className="!h-5"
                onClick={handleTriggerLatestUpdate}
              >
                {t('detailPanel.operation.update', { ns: 'plugin' })}
              </Button>
            )}
          </div>

          {/* Org Info Row */}
          <div className="mb-1 flex h-4 items-center justify-between">
            <div className="mt-0.5 flex items-center">
              <OrgInfo
                packageNameClassName="w-auto"
                orgName={author}
                packageName={name?.includes('/') ? (name.split('/').pop() || '') : name}
              />
              {!!source && <PluginSourceBadge source={source} />}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {!isReadmeView && (
          <div className="flex gap-1">
            <OperationDropdown
              source={source}
              onInfo={modalStates.showPluginInfo}
              onCheckVersion={handleUpdate}
              onRemove={modalStates.showDeleteConfirm}
              detailUrl={detailUrl}
            />
            <ActionButton onClick={onHide}>
              <RiCloseLine className="h-4 w-4" />
            </ActionButton>
          </div>
        )}
      </div>

      {/* Deprecation Notice */}
      {isFromMarketplace && (
        <DeprecationNotice
          status={status}
          deprecatedReason={deprecated_reason}
          alternativePluginId={alternative_plugin_id}
          alternativePluginURL={getMarketplaceUrl(`/plugins/${alternative_plugin_id}`, { language: currentLocale, theme })}
          className="mt-3"
        />
      )}

      {/* Description */}
      {!isReadmeView && <Description className="mb-2 mt-3 h-auto" text={description[locale]} descriptionLineRows={2} />}

      {/* Plugin Auth for Tools */}
      {category === PluginCategoryEnum.tool && !isReadmeView && (
        <PluginAuth
          pluginPayload={{
            provider: provider?.name || '',
            category: AuthCategory.tool,
            providerType: provider?.type || '',
            detail,
          }}
        />
      )}

      {/* Modals */}
      <HeaderModals
        detail={detail}
        modalStates={modalStates}
        targetVersion={versionPicker.targetVersion}
        isDowngrade={versionPicker.isDowngrade}
        isAutoUpgradeEnabled={isAutoUpgradeEnabled}
        onUpdatedFromMarketplace={handleUpdatedFromMarketplace}
        onDelete={handleDelete}
      />
    </div>
  )
}

export default DetailHeader
