import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppMetadataForm } from '@/app/components/app/app-metadata'
import { DeleteAppForm } from '@/app/components/app/delete-app-form'
import { SwitchAppDialogContent } from '@/app/components/app/switch-app-dialog'
import { useSwitchAppMutation } from '@/app/components/app/switch-app-dialog/use-switch-app-mutation'
import UpdateDSLModal from '@/app/components/workflow/update-dsl-modal'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'
import { ExportAppDialogContent } from './export-app-dialog'

export type AppInfoDialogHandles = {
  edit: DialogHandle
  duplicate: DialogHandle
  switchApp: DialogHandle
  importDSL: DialogHandle
  delete: AlertDialogHandle
  export: AlertDialogHandle
}

type AppInfoDialogsProps = {
  appDetail: AppDetailWithSite
  handles: AppInfoDialogHandles
}

export function AppInfoDialogs({ appDetail, handles }: AppInfoDialogsProps) {
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
  const switching = useSwitchAppMutation()
  const [backupDialog] = useState(() => createAlertDialogHandle())
  return (
    <>
      <Dialog
        handle={handles.edit}
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && edit.isPending && details.reason !== 'imperative-action') details.cancel()
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
                    handles.edit.close()
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
        handle={handles.duplicate}
        onOpenChange={(open, details) => {
          if (!open && copy.isPending && details.reason !== 'imperative-action') details.cancel()
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
                    handles.duplicate.close()
                    getRedirection(app, replace, { isRbacEnabled })
                  },
                },
              )
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        handle={handles.switchApp}
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && switching.isPending && details.reason !== 'imperative-action')
            details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) switching.reset()
        }}
      >
        <SwitchAppDialogContent
          sourceApp={appDetail}
          isPending={switching.isPending}
          onSubmit={(body, removeOriginal) => {
            if (switching.isPending) return
            switching.mutate(
              { sourceApp: appDetail, body, removeOriginal },
              { onSuccess: () => handles.switchApp.close() },
            )
          }}
        />
      </Dialog>
      <AlertDialog
        handle={handles.delete}
        onOpenChange={(open, details) => {
          if (!open && deletion.isPending && details.reason !== 'imperative-action')
            details.cancel()
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
                    handles.delete.close()
                    toast.success(t(($) => $.appDeleted))
                    replace('/apps')
                  },
                },
              )
            }}
          />
        </AlertDialogContent>
      </AlertDialog>
      <UpdateDSLModal
        handle={handles.importDSL}
        appId={appDetail.id}
        appMode={appDetail.mode}
        onBackup={() => backupDialog.open(null)}
      >
        <AlertDialog handle={backupDialog}>
          <ExportAppDialogContent appDetail={appDetail} onExported={() => backupDialog.close()} />
        </AlertDialog>
      </UpdateDSLModal>
      <AlertDialog handle={handles.export}>
        <ExportAppDialogContent appDetail={appDetail} onExported={() => handles.export.close()} />
      </AlertDialog>
    </>
  )
}
