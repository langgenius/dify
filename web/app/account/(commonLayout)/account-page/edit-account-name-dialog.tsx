'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { ORPCError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { EditAccountNameForm } from '@/app/components/account/edit-account-name-form'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

export function EditAccountNameDialog({ name }: { name: string }) {
  const { t } = useTranslation(['common'])
  const actionsRef = useRef<DialogActions>(null)
  const updateProfile = useMutation(consoleQuery.account.profile.patch.mutationOptions())

  const handleSave = async (name: string) => {
    try {
      await updateProfile.mutateAsync({ body: { name } })
      actionsRef.current?.close()
    } catch (error) {
      // HTTP error notifications are owned by the request layer.
      // Only report a failure that never produced a response.
      if (!(error instanceof ORPCError) && error instanceof Error && error.message)
        toast.error(error.message)
    }
  }

  return (
    <Dialog
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (!open && updateProfile.isPending && details.reason !== 'imperative-action')
          details.cancel()
      }}
    >
      <DialogTrigger className="cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 system-sm-medium text-components-button-tertiary-text">
        {t(($) => $['operation.edit'])}
      </DialogTrigger>
      <DialogContent className="w-105">
        <EditAccountNameForm name={name} isPending={updateProfile.isPending} onSave={handleSave} />
      </DialogContent>
    </Dialog>
  )
}
