'use client'

import type { FC } from 'react'
import type { PluginDetail } from '../../../types'
import type { ModalStates, VersionTarget } from '../hooks'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
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
      {isShowPluginInfo && (
        <PluginInfo
          repository={isFromGitHub ? meta?.repo : ''}
          release={version}
          packageName={meta?.package || ''}
          onHide={hidePluginInfo}
        />
      )}

      <AlertDialog
        open={isShowDeleteConfirm}
        onOpenChange={(open) => {
          if (!open)
            hideDeleteConfirm()
        }}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pb-4 pt-6">
            <AlertDialogTitle className="text-text-primary title-2xl-semi-bold">
              {t(`${i18nPrefix}.delete`, { ns: 'plugin' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full whitespace-pre-wrap break-words text-text-tertiary system-md-regular">
              {t(`${i18nPrefix}.deleteContentLeft`, { ns: 'plugin' })}
              <span className="text-text-secondary system-md-semibold">{label[locale]}</span>
              {t(`${i18nPrefix}.deleteContentRight`, { ns: 'plugin' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={deleting}>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={deleting} disabled={deleting} onClick={onDelete}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>

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
