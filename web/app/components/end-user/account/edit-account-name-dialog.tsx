'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { EditAccountNameForm } from '@/app/components/account/edit-account-name-form'
import { webAppQuery } from '@/service/webapp'

export default function EditAccountNameDialog({
  name,
  authSession,
}: {
  name: string
  authSession: number
}) {
  const { t } = useTranslation(['common'])
  const actionsRef = useRef<DialogActions>(null)
  const updateProfile = useMutation(
    webAppQuery.account.profile.patch.mutationOptions({ context: { authSession, silent: true } }),
  )
  const save = async (name: string) => {
    try {
      await updateProfile.mutateAsync({ body: { name } })
      actionsRef.current?.close()
    } catch {
      // The form displays the mutation error.
    }
  }

  return (
    <Dialog
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (open) updateProfile.reset()
        if (!open && updateProfile.isPending && details.reason !== 'imperative-action')
          details.cancel()
      }}
    >
      <DialogTrigger className="cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 system-sm-medium text-components-button-tertiary-text">
        {t(($) => $['operation.edit'], { ns: 'common' })}
      </DialogTrigger>
      <DialogContent className="w-105">
        <EditAccountNameForm
          name={name}
          isPending={updateProfile.isPending}
          onSave={save}
          error={updateProfile.error?.message}
        />
      </DialogContent>
    </Dialog>
  )
}
