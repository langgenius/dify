'use client'

import type { FC } from 'react'
import type { PluginDetail } from '../../../types'
import type { ModalStates, VersionTarget } from '../hooks'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import PluginInfoContent from '@/app/components/plugins/plugin-page/plugin-info'
import MarketplaceUpdateDialog from '@/app/components/plugins/update-plugin/from-market-place'
import { useGetLanguage } from '@/context/i18n'
import { PluginSource } from '../../../types'

const i18nPrefix = 'action'

type HeaderModalsProps = {
  detail: PluginDetail
  modalStates: ModalStates
  targetVersion: VersionTarget | undefined
  onUpdatedFromMarketplace: () => void | Promise<void>
  onDelete: () => void
  deleting: boolean
}

const HeaderModals: FC<HeaderModalsProps> = ({
  detail,
  modalStates,
  targetVersion,
  onUpdatedFromMarketplace,
  onDelete,
  deleting,
}) => {
  const { t } = useTranslation(['common', 'plugin'])
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
  } = modalStates

  return (
    <>
      <Dialog
        open={isShowPluginInfo}
        onOpenChange={(open) => {
          if (!open) hidePluginInfo()
        }}
      >
        <DialogContent className="w-120">
          <PluginInfoContent
            repository={isFromGitHub ? meta?.repo : ''}
            release={version}
            packageName={meta?.package || ''}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isShowDeleteConfirm}
        onOpenChange={(open, details) => {
          if (!open && deleting) details.cancel()
          else if (!open) hideDeleteConfirm()
        }}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $[`${i18nPrefix}.delete`], { ns: 'plugin' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $[`${i18nPrefix}.deleteContentLeft`], { ns: 'plugin' })}
              <span className="system-md-semibold text-text-secondary">{label[locale]}</span>
              {t(($) => $[`${i18nPrefix}.deleteContentRight`], { ns: 'plugin' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={deleting}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={deleting} onClick={onDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {targetVersion && (
        <MarketplaceUpdateDialog
          open={isShowUpdateModal}
          pluginId={targetVersion.plugin.plugin_id}
          payload={{
            category: targetVersion.plugin.declaration.category,
            originalPackageInfo: {
              id: targetVersion.plugin.plugin_unique_identifier,
              payload: targetVersion.plugin.declaration,
            },
            targetPackageInfo: {
              id: targetVersion.unique_identifier,
              version: targetVersion.version,
            },
          }}
          onRefresh={onUpdatedFromMarketplace}
          onClose={hideUpdateModal}
          warnAboutAutoUpdate={!!targetVersion.warnAboutAutoUpdate}
        />
      )}
    </>
  )
}

export default HeaderModals
