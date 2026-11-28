'use client'

import type {
  AppPartial,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import { AlertDialog } from '@langgenius/dify-ui/alert-dialog'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AppMetadataForm } from '@/app/components/app/app-metadata'
import { ExportSecretsDialogContent } from '@/app/components/app/export-secrets-dialog'
import { SwitchAppDialogContent } from '@/app/components/app/switch-app-dialog'
import { useSwitchAppMutation } from '@/app/components/app/switch-app-dialog/use-switch-app-mutation'
import { useExportAppDsl } from '@/app/components/app/use-export-app-dsl'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'

type ExportSecretsDialogPayload = {
  app: Pick<AppPartial, 'id' | 'name'>
  envList: EnvironmentVariableItemResponse[]
}

export type AppListDialogHandles = {
  edit: DialogHandle<AppPartial>
  duplicate: DialogHandle<AppPartial>
  switchApp: DialogHandle<AppPartial>
  exportSecrets: AlertDialogHandle<ExportSecretsDialogPayload>
}

export function AppListDialogs({ handles }: { handles: AppListDialogHandles }) {
  const { t } = useTranslation(['app'])
  const { push } = useRouter()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const editNameRef = useRef<HTMLInputElement>(null)
  const duplicateNameRef = useRef<HTMLInputElement>(null)
  const edit = useMutation(
    consoleQuery.apps.byAppId.put.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const copy = useMutation(
    consoleQuery.apps.byAppId.copy.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const switching = useSwitchAppMutation()
  const secretExport = useExportAppDsl()

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
        {({ payload }) => (
          <DialogContent initialFocus={editNameRef}>
            {payload && (
              <AppMetadataForm
                appDetail={payload}
                nameInputRef={editNameRef}
                operation="edit"
                isPending={edit.isPending}
                error={edit.error?.message}
                onSubmit={(body) => {
                  if (edit.isPending) return
                  edit.mutate(
                    { params: { app_id: payload.id }, body },
                    { onSuccess: () => handles.edit.close() },
                  )
                }}
              />
            )}
          </DialogContent>
        )}
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
        {({ payload }) => (
          <DialogContent initialFocus={duplicateNameRef}>
            {payload && (
              <AppMetadataForm
                appDetail={payload}
                nameInputRef={duplicateNameRef}
                operation="duplicate"
                isPending={copy.isPending}
                error={copy.error?.message}
                onSubmit={({ name, icon_type, icon, icon_background }) => {
                  if (copy.isPending) return
                  copy.mutate(
                    {
                      params: { app_id: payload.id },
                      body: { name, icon_type, icon, icon_background },
                    },
                    {
                      onSuccess: (newApp) => {
                        if (!('mode' in newApp)) {
                          toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
                          return
                        }
                        handles.duplicate.close()
                        getRedirection(newApp, push, {
                          currentUserId,
                          resourceMaintainer: newApp.maintainer ?? undefined,
                          workspacePermissionKeys,
                          isRbacEnabled: systemFeatures.rbac_enabled,
                        })
                      },
                    },
                  )
                }}
              />
            )}
          </DialogContent>
        )}
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
        {({ payload }) =>
          payload && (
            <SwitchAppDialogContent
              sourceApp={payload}
              isPending={switching.isPending}
              onSubmit={(body, removeOriginal) => {
                if (switching.isPending) return
                switching.mutate(
                  { sourceApp: payload, body, removeOriginal },
                  { onSuccess: () => handles.switchApp.close() },
                )
              }}
            />
          )
        }
      </Dialog>
      <AlertDialog
        handle={handles.exportSecrets}
        onOpenChange={(open, details) => {
          if (!open && secretExport.isExporting && details.reason !== 'imperative-action')
            details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) secretExport.reset()
        }}
      >
        {({ payload }) =>
          payload && (
            <ExportSecretsDialogContent
              envList={payload.envList}
              errorMessage={secretExport.errorMessage}
              isExporting={secretExport.isExporting}
              onConfirm={async (includeSecret) => {
                if (secretExport.isExporting) return
                const result = await secretExport.exportAppDsl({
                  appId: payload.app.id,
                  appName: payload.app.name,
                  includeSecret,
                  feedback: 'dialog',
                })
                if (result.status === 'downloaded') handles.exportSecrets.close()
              }}
            />
          )
        }
      </AlertDialog>
    </>
  )
}
