'use client'

import type { ChangeEmailActions } from '@/app/components/account/change-email-dialog'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import ChangeEmailDialog from '@/app/components/account/change-email-dialog'
import { webAppClient, webAppQuery } from '@/service/webapp'

type Props = {
  email: string
  authSession: number
  onClose: () => void
}

export default function EmailChangeModal({ email: initialEmail, authSession, onClose }: Props) {
  const [email] = useState(initialEmail)
  const context = { authSession, silent: true }
  const updateEmail = useMutation(
    webAppQuery.account.changeEmail.reset.post.mutationOptions({ context }),
  )
  const actions: ChangeEmailActions = {
    sendCode: (body) => webAppClient.account.changeEmail.post({ body }, { context }),
    verifyCode: (body) => webAppClient.account.changeEmail.validity.post({ body }, { context }),
    checkEmailUnique: (body) =>
      webAppClient.account.changeEmail.checkEmailUnique.post({ body }, { context }),
    changeEmail: async (body) => {
      await updateEmail.mutateAsync({ body })
      onClose()
    },
  }

  return <ChangeEmailDialog email={email} onClose={onClose} actions={actions} />
}
