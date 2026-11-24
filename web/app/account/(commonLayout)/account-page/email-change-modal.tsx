'use client'

import { useMutation } from '@tanstack/react-query'
import ChangeEmailDialog from '@/app/components/account/change-email-dialog'
import { logoutMutationOptions } from '@/service/common-queries'
import { consoleClient } from '@/service/console'

type Props = {
  onClose: () => void
  email: string
}

export default function EmailChangeModal({ email, onClose }: Props) {
  const { mutateAsync: logout } = useMutation(logoutMutationOptions())
  return (
    <ChangeEmailDialog
      email={email}
      onClose={onClose}
      actions={{
        sendCode: (body) =>
          consoleClient.account.changeEmail.post({ body }, { context: { silent: true } }),
        verifyCode: (body) =>
          consoleClient.account.changeEmail.validity.post({ body }, { context: { silent: true } }),
        checkEmailUnique: (body) =>
          consoleClient.account.changeEmail.checkEmailUnique.post(
            { body },
            { context: { silent: true } },
          ),
        changeEmail: async (body) => {
          await consoleClient.account.changeEmail.reset.post(
            { body },
            { context: { silent: true } },
          )
          await logout()
        },
      }}
    />
  )
}
