import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { AlertDialogProps } from '@langgenius/dify-ui/alert-dialog'
import type { DialogProps } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import SwitchAppModal from '@/app/components/app/switch-app-modal'
import UpdateDSLModal from '@/app/components/workflow/update-dsl-modal'
import { AppMetadataDialog } from './app-metadata-dialog'
import { DeleteAppDialog } from './delete-app-dialog'
import { ExportAppDialog } from './export-app-dialog'

export type AppInfoOperation = 'edit' | 'duplicate' | 'delete' | 'switch' | 'importDSL'

type AppInfoModalsProps = {
  appDetail: AppDetailWithSite
  activeModal: AppInfoOperation | null
  onOpenChange: DialogProps['onOpenChange']
  exportOpen: AlertDialogProps['open']
  onExportOpenChange: AlertDialogProps['onOpenChange']
}

export default function AppInfoModals({
  appDetail,
  activeModal,
  onOpenChange,
  exportOpen,
  onExportOpenChange,
}: AppInfoModalsProps) {
  return (
    <>
      <AppMetadataDialog
        appDetail={appDetail}
        operation="edit"
        open={activeModal === 'edit'}
        onOpenChange={onOpenChange}
      />
      <AppMetadataDialog
        appDetail={appDetail}
        operation="duplicate"
        open={activeModal === 'duplicate'}
        onOpenChange={onOpenChange}
      />
      <SwitchAppModal
        sourceApp={appDetail}
        open={activeModal === 'switch'}
        onOpenChange={onOpenChange}
      />
      <DeleteAppDialog
        appDetail={appDetail}
        open={activeModal === 'delete'}
        onOpenChange={onOpenChange}
      />
      <ImportAppDialog
        appDetail={appDetail}
        open={activeModal === 'importDSL'}
        onOpenChange={onOpenChange}
      />
      <ExportAppDialog appDetail={appDetail} open={exportOpen} onOpenChange={onExportOpenChange} />
    </>
  )
}

function ImportAppDialog({
  appDetail,
  open,
  onOpenChange,
}: {
  appDetail: AppDetailWithSite
  open: DialogProps['open']
  onOpenChange: DialogProps['onOpenChange']
}) {
  const [backupOpen, setBackupOpen] = useState(false)
  return (
    <UpdateDSLModal
      appId={appDetail.id}
      appMode={appDetail.mode}
      open={open}
      onOpenChange={onOpenChange}
      onBackup={() => setBackupOpen(true)}
    >
      <ExportAppDialog appDetail={appDetail} open={backupOpen} onOpenChange={setBackupOpen} />
    </UpdateDSLModal>
  )
}
