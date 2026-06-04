'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type ArchiveAgentButtonProps = {
  agentId: string
  agentName: string
}

export function ArchiveAgentButton({
  agentId,
  agentName,
}: ArchiveAgentButtonProps) {
  const { t } = useTranslation()
  const { t: tAgentV2 } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)
  const archiveAgentMutation = useMutation(consoleQuery.agents.byAgentId.delete.mutationOptions())

  const handleArchive = () => {
    if (archiveAgentMutation.isPending)
      return

    archiveAgentMutation.mutate({
      params: {
        agent_id: agentId,
      },
    }, {
      onSuccess: () => {
        toast.success(tAgentV2('roster.archiveSuccess'))
        setOpen(false)
      },
      onError: () => {
        toast.error(tAgentV2('roster.archiveFailed'))
      },
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={(
          <Button
            size="small"
            variant="secondary"
            tone="destructive"
            className="gap-1"
            aria-label={tAgentV2('roster.archiveAgent', { name: agentName })}
          />
        )}
      >
        <span aria-hidden className="i-ri-archive-line size-3.5" />
        {tAgentV2('roster.archive')}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
            {tAgentV2('roster.archiveDialog.title', { name: agentName })}
          </AlertDialogTitle>
          <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
            {tAgentV2('roster.archiveDialog.description')}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton disabled={archiveAgentMutation.isPending}>
            {t('operation.cancel', { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={archiveAgentMutation.isPending}
            onClick={handleArchive}
          >
            {t('operation.confirm', { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
