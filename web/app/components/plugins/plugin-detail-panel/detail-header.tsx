import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import {
  RiArrowLeftRightLine,
  RiBugLine,
  RiCloseLine,
  RiHardDrive3Line,
  RiVerifiedBadgeLine,
} from '@remixicon/react'
import type { PluginDetail } from '../types'
import { PluginSource, PluginType } from '../types'
import Description from '../card/base/description'
import Icon from '../card/base/card-icon'
import Title from '../card/base/title'
import OrgInfo from '../card/base/org-info'
import { useGitHubReleases } from '../install-plugin/hooks'
import PluginVersionPicker from '@/app/components/plugins/update-plugin/plugin-version-picker'
import UpdateFromMarketplace from '@/app/components/plugins/update-plugin/from-market-place'
import OperationDropdown from '@/app/components/plugins/plugin-detail-panel/operation-dropdown'
import PluginInfo from '@/app/components/plugins/plugin-page/plugin-info'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Badge from '@/app/components/base/badge'
import Confirm from '@/app/components/base/confirm'
import Tooltip from '@/app/components/base/tooltip'
import Toast from '@/app/components/base/toast'
import { BoxSparkleFill } from '@/app/components/base/icons/src/vender/plugin'
import { Github } from '@/app/components/base/icons/src/public/common'
import { uninstallPlugin } from '@/service/plugins'
import { useGetLanguage } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useInvalidateAllToolProviders } from '@/service/use-tools'
import { API_PREFIX, MARKETPLACE_URL_PREFIX } from '@/config'
import cn from '@/utils/classnames'

const i18nPrefix = 'plugin.action'

type Props = {
  detail: PluginDetail
  onHide: () => void
  onUpdate: (isDelete?: boolean) => void
}

const DetailHeader = ({
  detail,
  onHide,
  onUpdate,
}: Props) => {
  const { t } = useTranslation()
  const locale = useGetLanguage()
  const { checkForUpdates, fetchReleases } = useGitHubReleases()
  const { setShowUpdatePluginModal } = useModalContext()
  const { refreshModelProviders } = useProviderContext()
  const invalidateAllToolProviders = useInvalidateAllToolProviders()

  const {
    installation_id,
    source,
    tenant_id,
    version,
    latest_unique_identifier,
    latest_version,
    meta,
    plugin_id,
  } = detail
  const { author, category, name, label, description, icon, verified } = detail.declaration
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

  const detailUrl = useMemo(() => {
    if (isFromGitHub)
      return `https://github.com/${meta!.repo}`
    if (isFromMarketplace)
      return `${MARKETPLACE_URL_PREFIX}/plugins/${author}/${name}`
    return ''
  }, [author, isFromGitHub, isFromMarketplace, meta, name])

  const [isShowUpdateModal, {
    setTrue: showUpdateModal,
    setFalse: hideUpdateModal,
  }] = useBoolean(false)

  const handleUpdate = async () => {
    if (isFromMarketplace) {
      showUpdateModal()
      return
    }

    const owner = meta!.repo.split('/')[0] || author
    const repo = meta!.repo.split('/')[1] || name
    const fetchedReleases = await fetchReleases(owner, repo)
    if (fetchedReleases.length === 0) return
    const { needUpdate, toastProps } = checkForUpdates(fetchedReleases, meta!.version)
    Toast.notify(toastProps)
    if (needUpdate) {
      setShowUpdatePluginModal({
        onSaveCallback: () => {
          onUpdate()
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
    onUpdate()
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
    const res = await uninstallPlugin(installation_id)
    hideDeleting()
    if (res.success) {
      hideDeleteConfirm()
      onUpdate(true)
      if (PluginType.model.includes(category))
        refreshModelProviders()
      if (PluginType.tool.includes(category))
        invalidateAllToolProviders()
    }
  }, [showDeleting, installation_id, hideDeleting, hideDeleteConfirm, onUpdate, category, refreshModelProviders, invalidateAllToolProviders])

  // #plugin TODO# used in apps
  // const usedInApps = 3

  return (
    <div className={cn('border-divider-subtle bg-components-panel-bg shrink-0 border-b p-4 pb-3')}>
      <div className="flex">
        <div className='border-components-panel-border-subtle overflow-hidden rounded-xl border'>
          <Icon src={`${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenant_id}&filename=${icon}`} />
        </div>
        <div className="ml-3 w-0 grow">
          <div className="flex h-5 items-center">
            <Title title={label[locale]} />
            {verified && <RiVerifiedBadgeLine className="text-text-accent ml-0.5 h-4 w-4 shrink-0" />}
            <PluginVersionPicker
              disabled={!isFromMarketplace}
              isShow={isShow}
              onShowChange={setIsShow}
              pluginID={plugin_id}
              currentVersion={version}
              onSelect={(state) => {
                setTargetVersion(state)
                handleUpdate()
              }}
              trigger={
                <Badge
                  className={cn(
                    'mx-1',
                    isShow && 'bg-state-base-hover',
                    (isShow || isFromMarketplace) && 'hover:bg-state-base-hover',
                  )}
                  uppercase={false}
                  text={
                    <>
                      <div>{isFromGitHub ? meta!.version : version}</div>
                      {isFromMarketplace && <RiArrowLeftRightLine className='text-text-tertiary ml-1 h-3 w-3' />}
                    </>
                  }
                  hasRedCornerMark={hasNewVersion}
                />
              }
            />
            {(hasNewVersion || isFromGitHub) && (
              <Button variant='secondary-accent' size='small' className='!h-5' onClick={() => {
                if (isFromMarketplace) {
                  setTargetVersion({
                    version: latest_version,
                    unique_identifier: latest_unique_identifier,
                  })
                }
                handleUpdate()
              }}>{t('plugin.detailPanel.operation.update')}</Button>
            )}
          </div>
          <div className='mb-1 flex h-4 items-center justify-between'>
            <div className='mt-0.5 flex items-center'>
              <OrgInfo
                packageNameClassName='w-auto'
                orgName={author}
                packageName={name}
              />
              <div className='text-text-quaternary system-xs-regular ml-1 mr-0.5'>·</div>
              {detail.source === PluginSource.marketplace && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.marketplace')} >
                  <div><BoxSparkleFill className='text-text-tertiary hover:text-text-accent h-3.5 w-3.5' /></div>
                </Tooltip>
              )}
              {detail.source === PluginSource.github && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.github')} >
                  <div><Github className='text-text-secondary hover:text-text-primary h-3.5 w-3.5' /></div>
                </Tooltip>
              )}
              {detail.source === PluginSource.local && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.local')} >
                  <div><RiHardDrive3Line className='text-text-tertiary h-3.5 w-3.5' /></div>
                </Tooltip>
              )}
              {detail.source === PluginSource.debugging && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.debugging')} >
                  <div><RiBugLine className='text-text-tertiary hover:text-text-warning h-3.5 w-3.5' /></div>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <div className='flex gap-1'>
          <OperationDropdown
            source={detail.source}
            onInfo={showPluginInfo}
            onCheckVersion={handleUpdate}
            onRemove={showDeleteConfirm}
            detailUrl={detailUrl}
          />
          <ActionButton onClick={onHide}>
            <RiCloseLine className='h-4 w-4' />
          </ActionButton>
        </div>
      </div>
      <Description className='mt-3' text={description[locale]} descriptionLineRows={2}></Description>
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
          title={t(`${i18nPrefix}.delete`)}
          content={
            <div>
              {t(`${i18nPrefix}.deleteContentLeft`)}<span className='system-md-semibold'>{label[locale]}</span>{t(`${i18nPrefix}.deleteContentRight`)}<br />
              {/* {usedInApps > 0 && t(`${i18nPrefix}.usedInApps`, { num: usedInApps })} */}
            </div>
          }
          onCancel={hideDeleteConfirm}
          onConfirm={handleDelete}
          isLoading={deleting}
          isDisabled={deleting}
        />
      )}
      {
        isShowUpdateModal && (
          <UpdateFromMarketplace
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
          />
        )
      }
    </div>
  )
}

export default DetailHeader
