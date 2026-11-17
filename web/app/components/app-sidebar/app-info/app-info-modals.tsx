import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { AlertDialog, AlertDialogContent } from '@langgenius/dify-ui/alert-dialog'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppMetadataForm } from '@/app/components/app/app-metadata'
import { DeleteAppForm } from '@/app/components/app/delete-app-form'
import SwitchAppModal from '@/app/components/app/switch-app-modal'
import UpdateDSLModal from '@/app/components/workflow/update-dsl-modal'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'
import { ExportAppDialog } from './export-app-dialog'

export type AppInfoOperation = 'edit' | 'duplicate' | 'delete' | 'switch' | 'importDSL' | 'export'

type AppInfoModalsProps = {
  appDetail: AppDetailWithSite
  activeModal: AppInfoOperation | null
  onClose: () => void
}

export default function AppInfoModals({ appDetail, activeModal, onClose }: AppInfoModalsProps) {
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
  const deletion = useMutation(
    consoleQuery.apps.byAppId.delete.mutationOptions({ context: { silent: true } }),
  )
  return (
    <>
      <Dialog
        open={activeModal === 'edit'}
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && edit.isPending) details.cancel()
          else if (!open) onClose()
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
                    onClose()
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
        open={activeModal === 'duplicate'}
        onOpenChange={(open, details) => {
          if (!open && copy.isPending) details.cancel()
          else if (!open) onClose()
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
                    onClose()
                    getRedirection(app, replace, { isRbacEnabled })
                  },
                },
              )
            }}
          />
        </DialogContent>
      </Dialog>
      <SwitchAppModal sourceApp={appDetail} open={activeModal === 'switch'} onClose={onClose} />
      <AlertDialog
        open={activeModal === 'delete'}
        onOpenChange={(open, details) => {
          if (!open && deletion.isPending) details.cancel()
          else if (!open) onClose()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) deletion.reset()
        }}
      >
        <AlertDialogContent>
          <DeleteAppForm
            appName={appDetail.name}
            isPending={deletion.isPending}
            error={
              deletion.isError
                ? `${t(($) => $.appDeleteFailed)}: ${deletion.error.message}`
                : undefined
            }
            onSubmit={() => {
              if (deletion.isPending) return
              deletion.mutate(
                { params: { app_id: appDetail.id } },
                {
                  onSuccess: () => {
                    onClose()
                    toast.success(t(($) => $.appDeleted))
                    replace('/apps')
                  },
                },
              )
            }}
          />
        </AlertDialogContent>
      </AlertDialog>
      <ImportAppDialog appDetail={appDetail} open={activeModal === 'importDSL'} onClose={onClose} />
      <ExportAppDialog appDetail={appDetail} open={activeModal === 'export'} onClose={onClose} />
    </>
  )
}

function ImportAppDialog({
  appDetail,
  open,
  onClose,
}: {
  appDetail: AppDetailWithSite
  open: boolean
  onClose: () => void
}) {
  const [backupOpen, setBackupOpen] = useState(false)
  return (
    <UpdateDSLModal
      appId={appDetail.id}
      appMode={appDetail.mode}
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onBackup={() => setBackupOpen(true)}
    >
      <ExportAppDialog
        appDetail={appDetail}
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
      />
    </UpdateDSLModal>
  )
}
