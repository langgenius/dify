'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'

export function DeleteDeploymentDialog({
  appInstanceId,
  appName,
  open,
  onOpenChange,
}: {
  appInstanceId: string
  appName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const deleteInstance = useMutation(consoleQuery.enterprise.appInstanceService.deleteAppInstance.mutationOptions())
  const displayName = appName || appInstanceId

  function handleDelete() {
    deleteInstance.mutate(
      {
        params: {
          appInstanceId,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('settings.deleted'))
          router.push('/deployments')
        },
        onError: () => {
          toast.error(t('settings.deleteFailed'))
        },
        onSettled: () => {
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && deleteInstance.isPending)
          return
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent className="w-120">
        <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('settings.deleteConfirmTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular text-text-tertiary">
            {t('settings.deleteConfirmDesc', { name: displayName })}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="pt-3">
          <AlertDialogCancelButton variant="secondary" disabled={deleteInstance.isPending}>
            {t('createModal.cancel')}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={deleteInstance.isPending}
            onClick={handleDelete}
          >
            {t('settings.delete')}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
