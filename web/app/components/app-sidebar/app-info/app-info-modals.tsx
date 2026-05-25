import type { AppInfoModalType } from './use-app-info-actions'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { App, AppSSO } from '@/types/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { DSLExportConfirmContent } from '@/app/components/workflow/dsl-export-confirm-modal'
import dynamic from '@/next/dynamic'

const SwitchAppModal = dynamic(() => import('@/app/components/app/switch-app-modal'), { ssr: false })
const CreateAppModal = dynamic(() => import('@/app/components/explore/create-app-modal'), { ssr: false })
const DuplicateAppModal = dynamic(() => import('@/app/components/app/duplicate-modal'), { ssr: false })
const UpdateDSLModal = dynamic(() => import('@/app/components/workflow/update-dsl-modal'), { ssr: false })

type AppInfoModalsProps = {
  appDetail: App & Partial<AppSSO>
  activeModal: AppInfoModalType
  closeModal: () => void
  secretEnvList: EnvironmentVariable[]
  setSecretEnvList: (list: EnvironmentVariable[]) => void
  onEdit: CreateAppModalProps['onConfirm']
  onCopy: DuplicateAppModalProps['onConfirm']
  onExport: (include?: boolean) => Promise<void>
  exportCheck: () => void
  handleConfirmExport: () => Promise<void>
  onConfirmDelete: () => void
}

const AppInfoModals = ({
  appDetail,
  activeModal,
  closeModal,
  secretEnvList,
  setSecretEnvList,
  onEdit,
  onCopy,
  onExport,
  exportCheck,
  handleConfirmExport,
  onConfirmDelete,
}: AppInfoModalsProps) => {
  const { t } = useTranslation()
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
  const [isConfirmingExport, setIsConfirmingExport] = useState(false)
  const [isSecretExporting, setIsSecretExporting] = useState(false)
  const isDeleteConfirmDisabled = confirmDeleteInput !== appDetail.name
  const exportDialogMode = secretEnvList.length > 0
    ? 'secret'
    : activeModal === 'exportWarning'
      ? 'warning'
      : null
  const isExportDialogOpen = exportDialogMode !== null

  const handleDeleteDialogClose = () => {
    setConfirmDeleteInput('')
    closeModal()
  }

  const handleExportWarningConfirm = useCallback(async () => {
    if (isConfirmingExport)
      return

    setIsConfirmingExport(true)
    try {
      await handleConfirmExport()
    }
    finally {
      setIsConfirmingExport(false)
    }
  }, [handleConfirmExport, isConfirmingExport])

  const handleExportDialogClose = useCallback(() => {
    if (exportDialogMode === 'secret') {
      setSecretEnvList([])
      return
    }

    closeModal()
  }, [closeModal, exportDialogMode, setSecretEnvList])

  const handleExportDialogOpenChange = useCallback((open: boolean) => {
    if (open || isConfirmingExport || isSecretExporting)
      return

    handleExportDialogClose()
  }, [handleExportDialogClose, isConfirmingExport, isSecretExporting])

  return (
    <>
      {activeModal === 'switch' && (
        <SwitchAppModal
          inAppDetail
          show
          appDetail={appDetail}
          onClose={closeModal}
          onSuccess={closeModal}
        />
      )}
      {activeModal === 'edit' && (
        <CreateAppModal
          isEditModal
          appName={appDetail.name}
          appIconType={appDetail.icon_type}
          appIcon={appDetail.icon}
          appIconBackground={appDetail.icon_background}
          appIconUrl={appDetail.icon_url}
          appDescription={appDetail.description}
          appMode={appDetail.mode}
          appUseIconAsAnswerIcon={appDetail.use_icon_as_answer_icon}
          max_active_requests={appDetail.max_active_requests ?? null}
          show
          onConfirm={onEdit}
          onHide={closeModal}
        />
      )}
      {activeModal === 'duplicate' && (
        <DuplicateAppModal
          appName={appDetail.name}
          icon_type={appDetail.icon_type}
          icon={appDetail.icon}
          icon_background={appDetail.icon_background}
          icon_url={appDetail.icon_url}
          show
          onConfirm={onCopy}
          onHide={closeModal}
        />
      )}
      <AlertDialog open={activeModal === 'delete'} onOpenChange={open => !open && handleDeleteDialogClose()}>
        <AlertDialogContent>
          <form
            className="flex flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              if (isDeleteConfirmDisabled)
                return
              onConfirmDelete()
            }}
          >
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                {t('deleteAppConfirmTitle', { ns: 'app' })}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {t('deleteAppConfirmContent', { ns: 'app' })}
              </AlertDialogDescription>
              <div className="mt-2">
                <label className="mb-1 block system-sm-regular text-text-secondary">
                  <Trans
                    i18nKey="deleteAppConfirmInputLabel"
                    ns="app"
                    values={{ appName: appDetail.name }}
                    components={{
                      appName: <span className="system-sm-semibold text-text-primary" translate="no" />,
                    }}
                  />
                </label>
                <Input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('deleteAppConfirmInputPlaceholder', { ns: 'app' })}
                  value={confirmDeleteInput}
                  onChange={e => setConfirmDeleteInput(e.target.value)}
                />
              </div>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton type="button">
                {t('operation.cancel', { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton type="submit" disabled={isDeleteConfirmDisabled}>
                {t('operation.confirm', { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </form>
        </AlertDialogContent>
      </AlertDialog>
      {activeModal === 'importDSL' && (
        <UpdateDSLModal
          onCancel={closeModal}
          onBackup={exportCheck}
        />
      )}
      <AlertDialog open={isExportDialogOpen} onOpenChange={handleExportDialogOpenChange}>
        {exportDialogMode === 'secret'
          ? (
              <DSLExportConfirmContent
                envList={secretEnvList}
                onConfirm={onExport}
                onClose={() => setSecretEnvList([])}
                onExportingChange={setIsSecretExporting}
              />
            )
          : exportDialogMode === 'warning' && (
            <AlertDialogContent>
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                  {t('sidebar.exportWarning', { ns: 'workflow' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t('sidebar.exportWarningDesc', { ns: 'workflow' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  tone="default"
                  loading={isConfirmingExport}
                  disabled={isConfirmingExport}
                  onClick={handleExportWarningConfirm}
                >
                  {isConfirmingExport
                    ? t('operation.exporting', { ns: 'common' })
                    : t('operation.confirm', { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          )}
      </AlertDialog>
    </>
  )
}

export default React.memo(AppInfoModals)
