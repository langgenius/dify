'use client'

import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

type DeleteAgentDialogProps = {
  agentId: string
  agentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}

export function DeleteAgentDialog({
  agentId,
  agentName,
  open,
  onOpenChange,
  onDeleted,
}: DeleteAgentDialogProps) {
  const { t } = useTranslation(['agentRoster'])
  const { t: tCommon } = useTranslation(['common'])
  const deleteAgentMutation = useMutation(consoleQuery.agent.byAgentId.delete.mutationOptions())

  const handleDelete = () => {
    if (deleteAgentMutation.isPending) return

    deleteAgentMutation.mutate(
      {
        params: {
          agent_id: agentId,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          onDeleted?.()
        },
        onError: () => {
          toast.error(t(($) => $['roster.deleteFailed'], { ns: 'agentRoster' }))
        },
      },
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['roster.deleteDialog.title'], { ns: 'agentRoster', name: agentName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['roster.deleteDialog.description'], { ns: 'agentRoster', name: agentName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={deleteAgentMutation.isPending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton loading={deleteAgentMutation.isPending} onClick={handleDelete}>
            {tCommon(($) => $['operation.delete'])}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
