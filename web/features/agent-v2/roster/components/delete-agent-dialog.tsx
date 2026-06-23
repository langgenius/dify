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
import { useTranslation } from '#i18n'
import { consoleQuery } from '@/service/client'

type DeleteAgentDialogProps = {
  agentId: string
  agentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteAgentDialog({
  agentId,
  agentName,
  open,
  onOpenChange,
}: DeleteAgentDialogProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const deleteAgentMutation = useMutation(consoleQuery.agent.byAgentId.delete.mutationOptions())

  const handleDelete = () => {
    if (deleteAgentMutation.isPending)
      return

    deleteAgentMutation.mutate({
      params: {
        agent_id: agentId,
      },
    }, {
      onSuccess: () => {
        toast.success(t('roster.deleteSuccess'))
        onOpenChange(false)
      },
      onError: () => {
        toast.error(t('roster.deleteFailed'))
      },
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="p-6">
        <AlertDialogTitle className="truncate title-2xl-semi-bold text-text-primary">
          {t('roster.deleteDialog.title', { name: agentName })}
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-2 system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
          {t('roster.deleteDialog.description')}
        </AlertDialogDescription>
        <AlertDialogActions className="p-0 pt-6">
          <AlertDialogCancelButton disabled={deleteAgentMutation.isPending}>
            {tCommon('operation.cancel')}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="destructive"
            loading={deleteAgentMutation.isPending}
            onClick={handleDelete}
          >
            {tCommon('operation.delete')}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
