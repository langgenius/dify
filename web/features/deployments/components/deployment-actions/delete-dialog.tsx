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
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import {
  deleteDeploymentDialogOpenAtom,
  deleteDeploymentInstanceMutationAtom,
  deploymentActionDisplayNameAtom,
  submitDeleteDeploymentInstanceAtom,
} from './state'

export function DeleteDeploymentDialog() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const [open, setOpen] = useAtom(deleteDeploymentDialogOpenAtom)
  const deleteInstance = useAtomValue(deleteDeploymentInstanceMutationAtom)
  const submitDeleteInstance = useSetAtom(submitDeleteDeploymentInstanceAtom)
  const displayName = useAtomValue(deploymentActionDisplayNameAtom)

  function handleDelete() {
    submitDeleteInstance({
      onSuccess: () => {
        toast.success(t('settings.deleted'))
        router.push('/deployments')
      },
      onError: () => {
        toast.error(t('settings.deleteFailed'))
      },
      onSettled: () => {
        setOpen(false)
      },
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && deleteInstance.isPending)
          return
        setOpen(nextOpen)
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
