import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { AlertDialogProps } from '@langgenius/dify-ui/alert-dialog'
import type { DialogActions, DialogProps } from '@langgenius/dify-ui/dialog'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppMetadataForm } from '@/app/components/app/app-metadata'
import SwitchAppModal from '@/app/components/app/switch-app-modal'
import UpdateDSLModal from '@/app/components/workflow/update-dsl-modal'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'
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
  const editActionsRef = useRef<DialogActions>(null)
  const duplicateActionsRef = useRef<DialogActions>(null)
  const editNameRef = useRef<HTMLInputElement>(null)
  const duplicateNameRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation(['app'])
  const { replace } = useRouter()
  const { data: isRbacEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (data) => data.rbac_enabled,
  })
  const edit = useMutation(
    consoleQuery.apps.byAppId.put.mutationOptions({ context: { silent: true } }),
  )
  const copy = useMutation(
    consoleQuery.apps.byAppId.copy.post.mutationOptions({ context: { silent: true } }),
  )
  return (
    <>
      <Dialog
        actionsRef={editActionsRef}
        open={activeModal === 'edit'}
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && edit.isPending && details.reason !== 'imperative-action') details.cancel()
          else onOpenChange?.(open, details)
        }}
        onOpenChangeComplete={(open) => {
          if (!open) edit.reset()
        }}
      >
        <DialogContent initialFocus={editNameRef}>
          <AppMetadataForm
            appDetail={appDetail}
            operation="edit"
            nameInputRef={editNameRef}
            isPending={edit.isPending}
            error={edit.error?.message}
            onSubmit={(body) => {
              if (edit.isPending) return
              edit.mutate(
                { params: { app_id: appDetail.id }, body },
                {
                  onSuccess: () => {
                    editActionsRef.current?.close()
                    void import('@/app/components/workflow/collaboration/core/websocket-manager')
                      .then(({ webSocketClient }) => {
                        webSocketClient.getSocket(appDetail.id)?.emit('collaboration_event', {
                          type: 'app_meta_update',
                          data: { timestamp: Date.now() },
                          timestamp: Date.now(),
                        })
                      })
                      .catch(() => {})
                  },
                },
              )
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        actionsRef={duplicateActionsRef}
        open={activeModal === 'duplicate'}
        onOpenChange={(open, details) => {
          if (!open && copy.isPending && details.reason !== 'imperative-action') details.cancel()
          else onOpenChange?.(open, details)
        }}
        onOpenChangeComplete={(open) => {
          if (!open) copy.reset()
        }}
      >
        <DialogContent initialFocus={duplicateNameRef}>
          <AppMetadataForm
            appDetail={appDetail}
            operation="duplicate"
            nameInputRef={duplicateNameRef}
            isPending={copy.isPending}
            error={copy.error?.message}
            onSubmit={({ name, icon_type, icon, icon_background }) => {
              if (copy.isPending) return
              copy.mutate(
                {
                  params: { app_id: appDetail.id },
                  body: { name, icon_type, icon, icon_background },
                },
                {
                  onSuccess: (app) => {
                    if (!('mode' in app)) {
                      toast.error(t(($) => $['newApp.appCreateFailed']))
                      return
                    }
                    duplicateActionsRef.current?.close()
                    getRedirection(app, replace, { isRbacEnabled })
                  },
                },
              )
            }}
          />
        </DialogContent>
      </Dialog>
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
