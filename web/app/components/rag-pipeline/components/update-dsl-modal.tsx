'use client'

import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { RiFileDownloadLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Uploader } from '@/app/components/app/create-from-dsl-modal/uploader'
import { useUpdateDSLModal } from '../hooks/use-update-dsl-modal'
import VersionMismatchModal from './version-mismatch-modal'

type UpdateDSLModalProps = {
  onCancel: () => void
  onBackup: () => void
  onImport?: () => void
}

const UpdateDSLModal = ({ onCancel, onBackup, onImport }: UpdateDSLModalProps) => {
  const { t } = useTranslation(['app', 'common', 'workflow'])
  const {
    currentFile,
    handleFile,
    show,
    showErrorModal,
    setShowErrorModal,
    loading,
    versions,
    handleImport,
    onUpdateDSLConfirm,
  } = useUpdateDSLModal({ onCancel, onImport })

  return (
    <>
      <Dialog
        open={show}
        onOpenChange={(open) => {
          if (!open) onCancel()
        }}
      >
        <DialogContent className="w-120">
          <DialogHeader>
            <DialogTitle>{t(($) => $['common.importDSL'], { ns: 'workflow' })}</DialogTitle>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogBody>
            <Alert type="warning" className="mb-2">
              <AlertTitle className="whitespace-pre-line">
                {t(($) => $['common.importDSLTip'], { ns: 'workflow' })}
              </AlertTitle>
              <AlertActions>
                <Button size="small" onClick={onBackup}>
                  <RiFileDownloadLine className="size-3.5" />
                  {t(($) => $['common.backupCurrentDraft'], { ns: 'workflow' })}
                </Button>
              </AlertActions>
            </Alert>
            <div>
              <div className="pt-2 system-md-semibold text-text-primary">
                {t(($) => $['common.chooseDSL'], { ns: 'workflow' })}
              </div>
              <div className="flex w-full flex-col items-start justify-center gap-4 self-stretch py-4">
                <Uploader
                  file={currentFile}
                  updateFile={handleFile}
                  className="mt-0! w-full"
                  importType="pipeline"
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onCancel}>{t(($) => $['newApp.Cancel'], { ns: 'app' })}</Button>
            <Button
              disabled={!currentFile}
              variant="primary"
              tone="destructive"
              onClick={handleImport}
              loading={loading}
            >
              {t(($) => $['common.overwriteAndImport'], { ns: 'workflow' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <VersionMismatchModal
        isShow={showErrorModal}
        versions={versions}
        onClose={() => setShowErrorModal(false)}
        onConfirm={onUpdateDSLConfirm}
      />
    </>
  )
}

export default memo(UpdateDSLModal)
