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
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import {
  deleteDeploymentDialogOpenAtom,
  deploymentActionAppInstanceAtom,
} from './state'

function DeleteDeploymentDialogContent() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const appInstance = useAtomValue(deploymentActionAppInstanceAtom)
  const setOpen = useSetAtom(deleteDeploymentDialogOpenAtom)
  const deleteInstance = useMutation(consoleQuery.enterprise.appInstanceService.deleteAppInstance.mutationOptions())
  const displayName = appInstance.displayName || appInstance.id

  function handleDelete() {
    deleteInstance.mutate(
      {
        params: {
          appInstanceId: appInstance.id,
        },
      },
      {
        onSuccess: () => {
          toast.success(t($ => $['settings.deleted']))
          router.push('/deployments')
        },
        onError: () => {
          toast.error(t($ => $['settings.deleteFailed']))
        },
        onSettled: () => {
          setOpen(false)
        },
      },
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
        <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
          {t($ => $['settings.deleteConfirmTitle'])}
        </AlertDialogTitle>
        <AlertDialogDescription className="system-sm-regular text-text-tertiary">
          {t($ => $['settings.deleteConfirmDesc'], { name: displayName })}
        </AlertDialogDescription>
      </div>
      <AlertDialogActions className="pt-3">
        <AlertDialogCancelButton variant="secondary" disabled={deleteInstance.isPending}>
          {t($ => $['createModal.cancel'])}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          loading={deleteInstance.isPending}
          onClick={handleDelete}
        >
          {t($ => $['settings.delete'])}
        </AlertDialogConfirmButton>
      </AlertDialogActions>
    </>
  )
}

export function DeleteDeploymentDialog() {
  const [open, setOpen] = useAtom(deleteDeploymentDialogOpenAtom)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="w-120">
        <DeleteDeploymentDialogContent />
      </AlertDialogContent>
    </AlertDialog>
  )
}
