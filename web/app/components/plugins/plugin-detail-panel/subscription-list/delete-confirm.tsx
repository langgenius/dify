import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { toast } from '@/app/components/base/ui/toast'
import { useDeleteTriggerSubscription } from '@/service/use-triggers'
import { useSubscriptionList } from './use-subscription-list'

type Props = {
  onClose: (deleted: boolean) => void
  isShow: boolean
  currentId: string
  currentName: string
  workflowsInUse: number
}

const tPrefix = 'subscription.list.item.actions.deleteConfirm'

export const DeleteConfirm = (props: Props) => {
  const { onClose, isShow, currentId, currentName, workflowsInUse } = props
  const { refetch } = useSubscriptionList()
  const { mutate: deleteSubscription, isPending: isDeleting } = useDeleteTriggerSubscription()
  const { t } = useTranslation()
  const [inputName, setInputName] = useState('')

  const handleOpenChange = (open: boolean) => {
    if (isDeleting)
      return

    if (!open)
      onClose(false)
  }

  const onConfirm = () => {
    if (workflowsInUse > 0 && inputName !== currentName) {
      toast.error(t(`${tPrefix}.confirmInputWarning`, { ns: 'pluginTrigger' }))
      return
    }
    deleteSubscription(currentId, {
      onSuccess: () => {
        toast.success(t(`${tPrefix}.success`, { ns: 'pluginTrigger', name: currentName }))
        refetch?.()
        onClose(true)
      },
      onError: (error: unknown) => {
        toast.error(error instanceof Error ? error.message : t(`${tPrefix}.error`, { ns: 'pluginTrigger', name: currentName }))
      },
    })
  }

  return (
    <AlertDialog open={isShow} onOpenChange={handleOpenChange}>
      <AlertDialogContent backdropProps={{ forceRender: true }}>
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
            {t(`${tPrefix}.title`, { ns: 'pluginTrigger', name: currentName })}
          </AlertDialogTitle>
          <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
            {workflowsInUse > 0
              ? t(`${tPrefix}.contentWithApps`, { ns: 'pluginTrigger', count: workflowsInUse })
              : t(`${tPrefix}.content`, { ns: 'pluginTrigger' })}
          </AlertDialogDescription>
          {workflowsInUse > 0 && (
            <div className="mt-6">
              <div className="mb-2 system-sm-medium text-text-secondary">
                {t(`${tPrefix}.confirmInputTip`, { ns: 'pluginTrigger', name: currentName })}
              </div>
              <Input
                value={inputName}
                onChange={e => setInputName(e.target.value)}
                placeholder={t(`${tPrefix}.confirmInputPlaceholder`, { ns: 'pluginTrigger', name: currentName })}
              />
            </div>
          )}
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton disabled={isDeleting}>
            {t('operation.cancel', { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton loading={isDeleting} disabled={isDeleting} onClick={onConfirm}>
            {t(`${tPrefix}.confirm`, { ns: 'pluginTrigger' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
