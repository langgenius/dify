import type { PluginDetail } from '../types'
import {
  RiArrowLeftRightLine,
  RiBugLine,
  RiCloseLine,
  RiHardDrive3Line,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { trackEvent } from '@/app/components/base/amplitude'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import { Github } from '@/app/components/base/icons/src/public/common'
import { BoxSparkleFill } from '@/app/components/base/icons/src/vender/plugin'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { AuthCategory, PluginAuth } from '@/app/components/plugins/plugin-auth'
import OperationDropdown from '@/app/components/plugins/plugin-detail-panel/operation-dropdown'
import PluginInfo from '@/app/components/plugins/plugin-page/plugin-info'
import UpdateFromMarketplace from '@/app/components/plugins/update-plugin/from-market-place'
import PluginVersionPicker from '@/app/components/plugins/update-plugin/plugin-version-picker'
import { API_PREFIX } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetLanguage, useLocale } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import useTheme from '@/hooks/use-theme'
import { uninstallPlugin } from '@/service/plugins'
import { useAllToolProviders, useInvalidateAllToolProviders } from '@/service/use-tools'
import { cn } from '@/utils/classnames'
import { getMarketplaceUrl } from '@/utils/var'
import { AutoUpdateLine } from '../../base/icons/src/vender/system'
import Verified from '../base/badges/verified'
import DeprecationNotice from '../base/deprecation-notice'
import Icon from '../card/base/card-icon'
import Description from '../card/base/description'
import OrgInfo from '../card/base/org-info'
import Title from '../card/base/title'
import { useGitHubReleases } from '../install-plugin/hooks'
import useReferenceSetting from '../plugin-page/use-reference-setting'
import { AUTO_UPDATE_MODE } from '../reference-setting-modal/auto-update-setting/types'
import { convertUTCDaySecondsToLocalSeconds, timeOfDayToDayjs } from '../reference-setting-modal/auto-update-setting/utils'
import { PluginCategoryEnum, PluginSource } from '../types'

const i18nPrefix = 'action'

type Props = {
  detail: PluginDetail
  isReadmeView?: boolean
  onHide?: () => void
  onUpdate?: (isDelete?: boolean) => void
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
  const { checkForUpdates, fetchReleases } = useGitHubReleases()
  const { setShowUpdatePluginModal } = useModalContext()
  const { refreshModelProviders } = useProviderContext()
  const invalidateAllToolProviders = useInvalidateAllToolProviders()
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)

  const {
    id,
    source,
    tenant_id,
    version,
    latest_unique_identifier,
    latest_version,
    meta,
    plugin_id,
    status,
    deprecated_reason,
    alternative_plugin_id,
  } = detail

  const { author, category, name, label, description, icon, icon_dark, verified, tool } = detail.declaration || detail
  const isTool = category === PluginCategoryEnum.tool
  const providerBriefInfo = tool?.identity
  const providerKey = `${plugin_id}/${providerBriefInfo?.name}`
  const { data: collectionList = [] } = useAllToolProviders(isTool)
  const provider = useMemo(() => {
    return collectionList.find(collection => collection.name === providerKey)
  }, [collectionList, providerKey])
  const isFromGitHub = source === PluginSource.github
  const isFromMarketplace = source === PluginSource.marketplace

  const [isShow, setIsShow] = useState(false)
  const [targetVersion, setTargetVersion] = useState({
    version: latest_version,
    unique_identifier: latest_unique_identifier,
  })
  const hasNewVersion = useMemo(() => {
    if (isFromMarketplace)
      return !!latest_version && latest_version !== version

    return false
  }, [isFromMarketplace, latest_version, version])

  const iconFileName = theme === 'dark' && icon_dark ? icon_dark : icon
  const iconSrc = iconFileName
    ? (iconFileName.startsWith('http') ? iconFileName : `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenant_id}&filename=${iconFileName}`)
    : ''

  const detailUrl = useMemo(() => {
    if (isFromGitHub)
      return `https://github.com/${meta!.repo}`
    if (isFromMarketplace)
      return getMarketplaceUrl(`/plugins/${author}/${name}`, { language: currentLocale, theme })
    return ''
  }, [author, isFromGitHub, isFromMarketplace, meta, name, theme])

  const [isShowUpdateModal, {
    setTrue: showUpdateModal,
    setFalse: hideUpdateModal,
  }] = useBoolean(false)

  const { referenceSetting } = useReferenceSetting()
  const { auto_upgrade: autoUpgradeInfo } = referenceSetting || {}
  const isAutoUpgradeEnabled = useMemo(() => {
    if (!enable_marketplace)
      return false
    if (!autoUpgradeInfo || !isFromMarketplace)
      return false
    if (autoUpgradeInfo.strategy_setting === 'disabled')
      return false
    if (autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.update_all)
      return true
    if (autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.partial && autoUpgradeInfo.include_plugins.includes(plugin_id))
      return true
    if (autoUpgradeInfo.upgrade_mode === AUTO_UPDATE_MODE.exclude && !autoUpgradeInfo.exclude_plugins.includes(plugin_id))
      return true
    return false
  }, [autoUpgradeInfo, plugin_id, isFromMarketplace])

  const [isDowngrade, setIsDowngrade] = useState(false)
  const handleUpdate = async (isDowngrade?: boolean) => {
    if (isFromMarketplace) {
      setIsDowngrade(!!isDowngrade)
      showUpdateModal()
      return
    }

    const owner = meta!.repo.split('/')[0] || author
    const repo = meta!.repo.split('/')[1] || name
    const fetchedReleases = await fetchReleases(owner, repo)
    if (fetchedReleases.length === 0)
      return
    const { needUpdate, toastProps } = checkForUpdates(fetchedReleases, meta!.version)
    Toast.notify(toastProps)
    if (needUpdate) {
      setShowUpdatePluginModal({
        onSaveCallback: () => {
          onUpdate?.()
        },
        payload: {
          type: PluginSource.github,
          category: detail.declaration.category,
          github: {
            originalPackageInfo: {
              id: detail.plugin_unique_identifier,
              repo: meta!.repo,
              version: meta!.version,
              package: meta!.package,
              releases: fetchedReleases,
            },
          },
        },
      })
    }
  }

  const handleUpdatedFromMarketplace = () => {
    onUpdate?.()
    hideUpdateModal()
  }

  const [isShowPluginInfo, {
    setTrue: showPluginInfo,
    setFalse: hidePluginInfo,
  }] = useBoolean(false)

  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)

  const [deleting, {
    setTrue: showDeleting,
    setFalse: hideDeleting,
  }] = useBoolean(false)

  const handleDelete = useCallback(async () => {
    showDeleting()
    const res = await uninstallPlugin(id)
    hideDeleting()
    if (res.success) {
      hideDeleteConfirm()
      onUpdate?.(true)
      if (PluginCategoryEnum.model.includes(category))
        refreshModelProviders()
      if (PluginCategoryEnum.tool.includes(category))
        invalidateAllToolProviders()
      trackEvent('plugin_uninstalled', { plugin_id, plugin_name: name })
    }
  }, [showDeleting, id, hideDeleting, hideDeleteConfirm, onUpdate, category, refreshModelProviders, invalidateAllToolProviders, plugin_id, name])

  return (
    <div className={cn('shrink-0 border-b border-divider-subtle bg-components-panel-bg p-4 pb-3', isReadmeView && 'border-b-0 bg-transparent p-0')}>
      <div className="flex">
        <div className={cn('overflow-hidden rounded-xl border border-components-panel-border-subtle', isReadmeView && 'bg-components-panel-bg')}>
          <Icon src={iconSrc} />
        </div>
        <div className="ml-3 w-0 grow">
          <div className="flex h-5 items-center">
            <Title title={label[locale]} />
            {verified && !isReadmeView && <Verified className="ml-0.5 h-4 w-4" text={t('marketplace.verifiedTip', { ns: 'plugin' })} />}
            {!!version && (
              <PluginVersionPicker
                disabled={!isFromMarketplace || isReadmeView}
                isShow={isShow}
                onShowChange={setIsShow}
                pluginID={plugin_id}
                currentVersion={version}
                onSelect={(state) => {
                  setTargetVersion(state)
                  handleUpdate(state.isDowngrade)
                }}
                trigger={(
                  <Badge
                    className={cn(
                      'mx-1',
                      isShow && 'bg-state-base-hover',
                      (isShow || isFromMarketplace) && 'hover:bg-state-base-hover',
                    )}
                    uppercase={false}
                    text={(
                      <>
                        <div>{isFromGitHub ? meta!.version : version}</div>
                        {isFromMarketplace && !isReadmeView && <RiArrowLeftRightLine className="ml-1 h-3 w-3 text-text-tertiary" />}
                      </>
                    )}
                    hasRedCornerMark={hasNewVersion}
                  />
                )}
              />
            )}
            {/* Auto update info */}
            {isAutoUpgradeEnabled && !isReadmeView && (
              <Tooltip popupContent={t('autoUpdate.nextUpdateTime', { ns: 'plugin', time: timeOfDayToDayjs(convertUTCDaySecondsToLocalSeconds(autoUpgradeInfo?.upgrade_time_of_day || 0, timezone!)).format('hh:mm A') })}>
                {/* add a a div to fix tooltip hover not show problem */}
                <div>
                  <Badge className="mr-1 cursor-pointer px-1">
                    <AutoUpdateLine className="size-3" />
                  </Badge>
                </div>
              </Tooltip>
            )}

            {(hasNewVersion || isFromGitHub) && (
              <Button
                variant="secondary-accent"
                size="small"
                className="!h-5"
                onClick={() => {
                  if (isFromMarketplace) {
                    setTargetVersion({
                      version: latest_version,
                      unique_identifier: latest_unique_identifier,
                    })
                  }
                  handleUpdate()
                }}
              >
                {t('detailPanel.operation.update', { ns: 'plugin' })}
              </Button>
            )}
          </div>
          <div className="mb-1 flex h-4 items-center justify-between">
            <div className="mt-0.5 flex items-center">
              <OrgInfo
                packageNameClassName="w-auto"
                orgName={author}
                packageName={name?.includes('/') ? (name.split('/').pop() || '') : name}
              />
              {!!source && (
                <>
                  <div className="system-xs-regular ml-1 mr-0.5 text-text-quaternary">·</div>
                  {source === PluginSource.marketplace && (
                    <Tooltip popupContent={t('detailPanel.categoryTip.marketplace', { ns: 'plugin' })}>
                      <div><BoxSparkleFill className="h-3.5 w-3.5 text-text-tertiary hover:text-text-accent" /></div>
                    </Tooltip>
                  )}
                  {source === PluginSource.github && (
                    <Tooltip popupContent={t('detailPanel.categoryTip.github', { ns: 'plugin' })}>
                      <div><Github className="h-3.5 w-3.5 text-text-secondary hover:text-text-primary" /></div>
                    </Tooltip>
                  )}
                  {source === PluginSource.local && (
                    <Tooltip popupContent={t('detailPanel.categoryTip.local', { ns: 'plugin' })}>
                      <div><RiHardDrive3Line className="h-3.5 w-3.5 text-text-tertiary" /></div>
                    </Tooltip>
                  )}
                  {source === PluginSource.debugging && (
                    <Tooltip popupContent={t('detailPanel.categoryTip.debugging', { ns: 'plugin' })}>
                      <div><RiBugLine className="h-3.5 w-3.5 text-text-tertiary hover:text-text-warning" /></div>
                    </Tooltip>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {!isReadmeView && (
          <div className="flex gap-1">
            <OperationDropdown
              source={source}
              onInfo={showPluginInfo}
              onCheckVersion={handleUpdate}
              onRemove={showDeleteConfirm}
              detailUrl={detailUrl}
            />
            <ActionButton onClick={onHide}>
              <RiCloseLine className="h-4 w-4" />
            </ActionButton>
          </div>
        )}
      </div>
      {isFromMarketplace && (
        <DeprecationNotice
          status={status}
          deprecatedReason={deprecated_reason}
          alternativePluginId={alternative_plugin_id}
          alternativePluginURL={getMarketplaceUrl(`/plugins/${alternative_plugin_id}`, { language: currentLocale, theme })}
          className="mt-3"
        />
      )}
      {!isReadmeView && <Description className="mb-2 mt-3 h-auto" text={description[locale]} descriptionLineRows={2}></Description>}
      {
        category === PluginCategoryEnum.tool && !isReadmeView && (
          <PluginAuth
            pluginPayload={{
              provider: provider?.name || '',
              category: AuthCategory.tool,
              providerType: provider?.type || '',
              detail,
            }}
          />
        )
      }
      {isShowPluginInfo && (
        <PluginInfo
          repository={isFromGitHub ? meta?.repo : ''}
          release={version}
          packageName={meta?.package || ''}
          onHide={hidePluginInfo}
        />
      )}
      {isShowDeleteConfirm && (
        <Confirm
          isShow
          title={t(`${i18nPrefix}.delete`, { ns: 'plugin' })}
          content={(
            <div>
              {t(`${i18nPrefix}.deleteContentLeft`, { ns: 'plugin' })}
              <span className="system-md-semibold">{label[locale]}</span>
              {t(`${i18nPrefix}.deleteContentRight`, { ns: 'plugin' })}
              <br />
            </div>
          )}
          onCancel={hideDeleteConfirm}
          onConfirm={handleDelete}
          isLoading={deleting}
          isDisabled={deleting}
        />
      )}
      {
        isShowUpdateModal && (
          <UpdateFromMarketplace
            pluginId={plugin_id}
            payload={{
              category: detail.declaration.category,
              originalPackageInfo: {
                id: detail.plugin_unique_identifier,
                payload: detail.declaration,
              },
              targetPackageInfo: {
                id: targetVersion.unique_identifier,
                version: targetVersion.version,
              },
            }}
            onCancel={hideUpdateModal}
            onSave={handleUpdatedFromMarketplace}
            isShowDowngradeWarningModal={isDowngrade && isAutoUpgradeEnabled}
          />
        )
      }
    </div>
  )
}

export default DetailHeader
