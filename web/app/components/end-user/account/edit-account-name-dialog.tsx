'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { zAccountProfilePatchPayload } from '@dify/contracts/api/web/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { EditAccountNameForm } from '@/app/components/account/edit-account-name-form'
import { webAppQuery } from '@/service/webapp'

const nameConstraints = zAccountProfilePatchPayload.shape.name.unwrap()

export default function EditAccountNameDialog({
  name,
  authSession,
}: {
  name: string
  authSession: number
}) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const actionsRef = useRef<DialogActions>(null)
  const updateProfile = useMutation(
    webAppQuery.account.profile.patch.mutationOptions({
      context: { authSession },
      meta: { errorToast: false },
    }),
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
      <DialogTrigger render={<Button variant="tertiary" className="cursor-pointer px-3" />}>
        {t(($) => $['operation.edit'], { ns: 'common' })}
      </DialogTrigger>
      <DialogContent className="w-105">
        <EditAccountNameForm
          name={name}
          isPending={updateProfile.isPending}
          onSave={save}
          error={updateProfile.error?.message}
          validateName={(value) => {
            const length = Array.from(value).length
            if (
              nameConstraints.minLength !== null &&
              nameConstraints.maxLength !== null &&
              (length < nameConstraints.minLength || length > nameConstraints.maxLength)
            )
              return t(($) => $['account.nameLengthInvalid'], {
                ns: 'accountSettings',
                min: nameConstraints.minLength,
                max: nameConstraints.maxLength,
              })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
