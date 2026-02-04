'use client'

import type { FC } from 'react'
import type { PluginDetail } from '../../../types'
import type { ModalStates, VersionTarget } from '../hooks'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import PluginInfo from '@/app/components/plugins/plugin-page/plugin-info'
import UpdateFromMarketplace from '@/app/components/plugins/update-plugin/from-market-place'
import { useGetLanguage } from '@/context/i18n'
import { PluginSource } from '../../../types'

const i18nPrefix = 'action'

type HeaderModalsProps = {
  detail: PluginDetail
  modalStates: ModalStates
  targetVersion: VersionTarget
  isDowngrade: boolean
  isAutoUpgradeEnabled: boolean
  onUpdatedFromMarketplace: () => void
  onDelete: () => void
}

const HeaderModals: FC<HeaderModalsProps> = ({
  detail,
  modalStates,
  targetVersion,
  isDowngrade,
  isAutoUpgradeEnabled,
  onUpdatedFromMarketplace,
  onDelete,
}) => {
  const { t } = useTranslation()
  const locale = useGetLanguage()

  const { source, version, meta } = detail
  const { label } = detail.declaration || detail
  const isFromGitHub = source === PluginSource.github

  const {
    isShowUpdateModal,
    hideUpdateModal,
    isShowPluginInfo,
    hidePluginInfo,
    isShowDeleteConfirm,
    hideDeleteConfirm,
    deleting,
  } = modalStates

  return (
    <>
      {/* Plugin Info Modal */}
      {isShowPluginInfo && (
        <PluginInfo
          repository={isFromGitHub ? meta?.repo : ''}
          release={version}
          packageName={meta?.package || ''}
          onHide={hidePluginInfo}
        />
      )}

      {/* Delete Confirm Modal */}
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
          onConfirm={onDelete}
          isLoading={deleting}
          isDisabled={deleting}
        />
      )}

      {/* Update from Marketplace Modal */}
      {isShowUpdateModal && (
        <UpdateFromMarketplace
          pluginId={detail.plugin_id}
          payload={{
            category: detail.declaration?.category ?? '',
            originalPackageInfo: {
              id: detail.plugin_unique_identifier,
              payload: detail.declaration ?? undefined,
            },
            targetPackageInfo: {
              id: targetVersion.unique_identifier || '',
              version: targetVersion.version || '',
            },
          }}
          onCancel={hideUpdateModal}
          onSave={onUpdatedFromMarketplace}
          isShowDowngradeWarningModal={isDowngrade && isAutoUpgradeEnabled}
        />
      )}
    </>
  )
}

export default HeaderModals
