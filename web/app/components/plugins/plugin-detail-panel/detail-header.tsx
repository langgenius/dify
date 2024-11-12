import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import {
  RiBugLine,
  RiCloseLine,
  RiHardDrive3Line,
  RiVerifiedBadgeLine,
} from '@remixicon/react'
import type { PluginDetail } from '../types'
import { PluginSource } from '../types'
import Description from '../card/base/description'
import Icon from '../card/base/card-icon'
import Title from '../card/base/title'
import OrgInfo from '../card/base/org-info'
import { useGitHubReleases } from '../install-plugin/hooks'
import { compareVersion, getLatestVersion } from '@/utils/semver'
import OperationDropdown from './operation-dropdown'
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
import UpdateFromMarketplace from '@/app/components/plugins/update-plugin/from-market-place'
import { API_PREFIX, MARKETPLACE_URL_PREFIX } from '@/config'
import cn from '@/utils/classnames'

const i18nPrefix = 'plugin.action'

type Props = {
  detail: PluginDetail
  onHide: () => void
  onUpdate: () => void
}

const DetailHeader = ({
  detail,
  onHide,
  onUpdate,
}: Props) => {
  const { t } = useTranslation()
  const locale = useGetLanguage()
  const { fetchReleases } = useGitHubReleases()
  const { setShowUpdatePluginModal } = useModalContext()

  const {
    installation_id,
    source,
    tenant_id,
    version,
    latest_unique_identifier,
    latest_version,
    meta,
  } = detail
  const { author, name, label, description, icon, verified } = detail.declaration
  const isFromGitHub = source === PluginSource.github
  const isFromMarketplace = source === PluginSource.marketplace

  const hasNewVersion = useMemo(() => {
    if (isFromGitHub)
      return latest_version !== version

    if (isFromMarketplace)
      return !!latest_version && latest_version !== version

    return false
  }, [isFromGitHub, isFromMarketplace, latest_version, version])

  const [isShowUpdateModal, {
    setTrue: showUpdateModal,
    setFalse: hideUpdateModal,
  }] = useBoolean(false)

  const handleUpdate = async () => {
    if (isFromMarketplace) {
      showUpdateModal()
      return
    }

    try {
      const fetchedReleases = await fetchReleases(author, name)
      if (fetchedReleases.length === 0)
        return
      const versions = fetchedReleases.map(release => release.tag_name)
      const latestVersion = getLatestVersion(versions)
      if (compareVersion(latestVersion, version) === 1) {
        setShowUpdatePluginModal({
          onSaveCallback: () => {
            onUpdate()
          },
          payload: {
            type: PluginSource.github,
            github: {
              originalPackageInfo: {
                id: installation_id,
                repo: meta!.repo,
                version: meta!.version,
                package: meta!.package,
                releases: fetchedReleases,
              },
            },
          },
        })
      }
      else {
        Toast.notify({
          type: 'info',
          message: 'No new version available',
        })
      }
    }
    catch {
      Toast.notify({
        type: 'error',
        message: 'Failed to compare versions',
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
      onUpdate()
    }
  }, [hideDeleteConfirm, hideDeleting, installation_id, showDeleting, onUpdate])

  // #plugin TODO# used in apps
  // const usedInApps = 3

  return (
    <div className={cn('shrink-0 p-4 pb-3 border-b border-divider-subtle bg-components-panel-bg')}>
      <div className="flex">
        <div className='overflow-hidden border-components-panel-border-subtle border rounded-xl'>
          <Icon src={`${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenant_id}&filename=${icon}`} />
        </div>
        <div className="ml-3 w-0 grow">
          <div className="flex items-center h-5">
            <Title title={label[locale]} />
            {verified && <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />}
            <Badge
              className='mx-1'
              text={version}
              hasRedCornerMark={hasNewVersion}
            />
            {hasNewVersion && (
              <Button variant='secondary-accent' size='small' className='!h-5' onClick={handleUpdate}>{t('plugin.detailPanel.operation.update')}</Button>
            )}
          </div>
          <div className='mb-1 flex justify-between items-center h-4'>
            <div className='mt-0.5 flex items-center'>
              <OrgInfo
                packageNameClassName='w-auto'
                orgName={author}
                packageName={name}
              />
              <div className='ml-1 mr-0.5 text-text-quaternary system-xs-regular'>·</div>
              {detail.source === PluginSource.marketplace && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.marketplace')} >
                  <div><BoxSparkleFill className='w-3.5 h-3.5 text-text-tertiary hover:text-text-accent' /></div>
                </Tooltip>
              )}
              {detail.source === PluginSource.github && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.github')} >
                  <div><Github className='w-3.5 h-3.5 text-text-secondary hover:text-text-primary' /></div>
                </Tooltip>
              )}
              {detail.source === PluginSource.local && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.local')} >
                  <div><RiHardDrive3Line className='w-3.5 h-3.5 text-text-tertiary' /></div>
                </Tooltip>
              )}
              {detail.source === PluginSource.debugging && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.debugging')} >
                  <div><RiBugLine className='w-3.5 h-3.5 text-text-tertiary hover:text-text-warning' /></div>
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
            detailUrl={`${MARKETPLACE_URL_PREFIX}/plugin/${author}/${name}`}
          />
          <ActionButton onClick={onHide}>
            <RiCloseLine className='w-4 h-4' />
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
              originalPackageInfo: {
                id: detail.plugin_unique_identifier,
                payload: detail.declaration,
              },
              targetPackageInfo: {
                id: latest_unique_identifier,
                version: latest_version,
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
