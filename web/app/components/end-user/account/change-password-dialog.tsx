'use client'

import type { WebAccountPasswordPayload } from '@dify/contracts/api/web/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { ORPCError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChangePasswordForm } from '@/app/components/account/change-password-form'
import { toast } from '@/app/notifications'
import { webAppQuery } from '@/service/webapp'

export default function ChangePasswordDialog({
  isPasswordSet,
  authSession,
}: {
  isPasswordSet: boolean
  authSession: number
}) {
  const { t } = useTranslation(['accountSettings', 'login'])
  const actionsRef = useRef<DialogActions>(null)
  const updatePassword = useMutation(
    webAppQuery.account.password.post.mutationOptions({ context: { authSession, silent: true } }),
  )
  let errorField: 'current-password' | 'new-password' | 'confirm-password' | undefined
  if (updatePassword.error instanceof ORPCError) {
    switch (updatePassword.error.code) {
      case 'current_password_incorrect':
        errorField = 'current-password'
        break
      case 'invalid_account_password':
        errorField = 'new-password'
        break
      case 'repeat_password_not_match':
        errorField = 'confirm-password'
        break
    }
  }
  const save = async (password: WebAccountPasswordPayload) => {
    try {
      await updatePassword.mutateAsync({ body: password })
      toast.success(t(($) => $.passwordChangedTip, { ns: 'login' }))
      actionsRef.current?.close()
    } catch {
      // The form displays the mutation error.
    }
  }

  return (
    <Dialog
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (open) updatePassword.reset()
        if (!open && updatePassword.isPending && details.reason !== 'imperative-action')
          details.cancel()
      }}
    >
      <DialogTrigger render={<Button />}>
        {isPasswordSet
          ? t(($) => $['account.resetPassword'], { ns: 'accountSettings' })
          : t(($) => $['account.setPassword'], { ns: 'accountSettings' })}
      </DialogTrigger>
      <DialogContent className="w-105">
        <ChangePasswordForm
          isPasswordSet={isPasswordSet}
          isPending={updatePassword.isPending}
          onSave={save}
          error={errorField ? undefined : updatePassword.error?.message}
          errors={
            errorField && updatePassword.error
              ? { [errorField]: updatePassword.error.message }
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  )
}
