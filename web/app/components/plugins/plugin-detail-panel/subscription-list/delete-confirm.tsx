import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeleteTriggerSubscription } from '@/service/use-triggers'
import { useSubscriptionList } from './use-subscription-list'

type Props = Readonly<{
  onClose: (deleted: boolean) => void
  isShow: boolean
  currentId: string
  currentName: string
  workflowsInUse: number
}>

const tPrefix = 'subscription.list.item.actions.deleteConfirm'

export const DeleteConfirm = (props: Props) => {
  const { onClose, isShow, currentId, currentName, workflowsInUse } = props
  const { refetch } = useSubscriptionList()
  const { mutate: deleteSubscription, isPending: isDeleting } = useDeleteTriggerSubscription()
  const { t } = useTranslation()
  const [inputName, setInputName] = useState('')

  const handleOpenChange = (open: boolean) => {
    if (isDeleting) return

    if (!open) onClose(false)
  }

  const onConfirm = () => {
    if (isDeleting) return

    if (workflowsInUse > 0 && inputName !== currentName) {
      toast.error(t(($) => $[`${tPrefix}.confirmInputWarning`], { ns: 'pluginTrigger' }))
      return
    }
    deleteSubscription(currentId, {
      onSuccess: () => {
        toast.success(t(($) => $[`${tPrefix}.success`], { ns: 'pluginTrigger', name: currentName }))
        refetch?.()
        onClose(true)
      },
      onError: (error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : t(($) => $[`${tPrefix}.error`], { ns: 'pluginTrigger', name: currentName }),
        )
      },
    })
  }

  return (
    <AlertDialog open={isShow} onOpenChange={handleOpenChange}>
      <AlertDialogContent backdropProps={{ forceRender: true }}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onConfirm()
          }}
        >
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $[`${tPrefix}.title`], { ns: 'pluginTrigger', name: currentName })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {workflowsInUse > 0
                ? t(($) => $[`${tPrefix}.contentWithApps`], {
                    ns: 'pluginTrigger',
                    count: workflowsInUse,
                  })
                : t(($) => $[`${tPrefix}.content`], { ns: 'pluginTrigger' })}
            </AlertDialogDescription>
            {workflowsInUse > 0 && (
              <Field className="mt-6 gap-2" name="confirmation">
                <FieldLabel className="py-0">
                  {t(($) => $[`${tPrefix}.confirmInputTip`], {
                    ns: 'pluginTrigger',
                    name: currentName,
                  })}
                </FieldLabel>
                <Input
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  placeholder={t(($) => $[`${tPrefix}.confirmInputPlaceholder`], {
                    ns: 'pluginTrigger',
                    name: currentName,
                  })}
                />
              </Field>
            )}
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={isDeleting}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton type="submit" loading={isDeleting}>
              {t(($) => $[`${tPrefix}.confirm`], { ns: 'pluginTrigger' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
