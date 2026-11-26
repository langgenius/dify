'use client'

import { useMutation } from '@tanstack/react-query'
import ChangeEmailDialog from '@/app/components/account/change-email-dialog'
import { logoutMutationOptions } from '@/service/common-queries'
import { consoleQuery } from '@/service/console'

type Props = {
  onClose: () => void
  email: string
}

export default function EmailChangeModal({ email, onClose }: Props) {
  const { mutateAsync: logout } = useMutation({
    ...logoutMutationOptions(),
    meta: { errorToast: false },
  })
  const { mutateAsync: sendCode } = useMutation(
    consoleQuery.account.changeEmail.post.mutationOptions({ meta: { errorToast: false } }),
  )
  const { mutateAsync: verifyCode } = useMutation(
    consoleQuery.account.changeEmail.validity.post.mutationOptions({ meta: { errorToast: false } }),
  )
  const { mutateAsync: checkEmailUnique } = useMutation(
    consoleQuery.account.changeEmail.checkEmailUnique.post.mutationOptions({
      // Advisory check: known conflicts show at the field, and sending the code reports the rest.
      meta: { errorToast: false },
    }),
  )
  const { mutateAsync: resetEmail } = useMutation(
    consoleQuery.account.changeEmail.reset.post.mutationOptions({ meta: { errorToast: false } }),
  )
  return (
    <ChangeEmailDialog
      email={email}
      onClose={onClose}
      actions={{
        sendCode: (body) => sendCode({ body }),
        verifyCode: (body) => verifyCode({ body }),
        checkEmailUnique: (body) => checkEmailUnique({ body }),
        changeEmail: async (body) => {
          await resetEmail({ body })
          await logout()
        },
      }}
    />
  )
}
