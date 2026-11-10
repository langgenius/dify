'use client'

import type { AccountPasswordPayload } from '@dify/contracts/api/console/account/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { ORPCError } from '@orpc/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChangePasswordForm } from '@/app/components/account/change-password-form'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'

export function ChangePasswordDialog({ isPasswordSet }: { isPasswordSet: boolean }) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const actionsRef = useRef<DialogActions>(null)
  const queryClient = useQueryClient()
  const updatePassword = useMutation(
    consoleQuery.account.password.post.mutationOptions({
      onSuccess: () => {
        // The request alone decides success; a slow profile refresh must not keep the dialog locked.
        void queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey })
      },
    }),
  )

  const handleSave = async (password: AccountPasswordPayload) => {
    try {
      await updatePassword.mutateAsync({ body: password })
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
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
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  )
}
