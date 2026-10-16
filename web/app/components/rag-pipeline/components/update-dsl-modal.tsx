'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { RiAlertFill, RiFileDownloadLine } from '@remixicon/react'
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
            <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
          </DialogHeader>
          <DialogBody>
            <div className="relative mb-2 flex grow gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs">
              <div className="pointer-events-none absolute top-0 left-0 size-full bg-toast-warning-bg opacity-40" />
              <div className="flex items-start justify-center p-1">
                <RiAlertFill className="size-4 shrink-0 text-text-warning-secondary" />
              </div>
              <div className="flex grow flex-col items-start gap-0.5 py-1">
                <div className="system-xs-medium whitespace-pre-line text-text-primary">
                  {t(($) => $['common.importDSLTip'], { ns: 'workflow' })}
                </div>
                <div className="flex items-start gap-1 self-stretch pt-1 pb-0.5">
                  <Button size="small" variant="secondary" className="relative" onClick={onBackup}>
                    <RiFileDownloadLine className="size-3.5 text-components-button-secondary-text" />
                    <div className="flex items-center justify-center gap-1">
                      {t(($) => $['common.backupCurrentDraft'], { ns: 'workflow' })}
                    </div>
                  </Button>
                </div>
              </div>
            </div>
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
