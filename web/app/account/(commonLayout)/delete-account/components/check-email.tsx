'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import Link from '@/next/link'
import { useSendDeleteAccountEmail } from '../state'

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function CheckEmail(props: DeleteAccountProps) {
  const { t } = useTranslation()
  const { data: userProfileEmail } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const [userInputEmail, setUserInputEmail] = useState('')

  const { isPending: isSendingEmail, mutateAsync: getDeleteEmailVerifyCode } =
    useSendDeleteAccountEmail()

  const handleConfirm = useCallback(async () => {
    if (isSendingEmail || userInputEmail !== userProfileEmail) return

    try {
      const ret = await getDeleteEmailVerifyCode()
      if (ret.result === 'success') props.onConfirm()
    } catch (error) {
      console.error(error)
    }
  }, [getDeleteEmailVerifyCode, isSendingEmail, props, userInputEmail, userProfileEmail])

  return (
    <Form
      onFormSubmit={() => {
        void handleConfirm()
      }}
    >
      <div className="py-1 body-md-medium text-text-destructive">
        {t(($) => $['account.deleteTip'], { ns: 'common' })}
      </div>
      <div className="pt-1 pb-2 body-md-regular text-text-secondary">
        {t(($) => $['account.deletePrivacyLinkTip'], { ns: 'common' })}
        <Link href="https://dify.ai/privacy" className="text-text-accent">
          {t(($) => $['account.deletePrivacyLink'], { ns: 'common' })}
        </Link>
      </div>
      <Field name="email" className="mt-3">
        <FieldLabel className="system-sm-semibold">
          {t(($) => $['account.deleteLabel'], { ns: 'common' })}
        </FieldLabel>
        <Input
          placeholder={t(($) => $['account.deletePlaceholder'], { ns: 'common' }) as string}
          value={userInputEmail}
          onValueChange={setUserInputEmail}
        />
      </Field>
      <div className="mt-3 flex w-full flex-col gap-2">
        <Button
          type="submit"
          className="w-full"
          disabled={userInputEmail !== userProfileEmail}
          loading={isSendingEmail}
          variant="primary"
        >
          {t(($) => $['account.sendVerificationButton'], { ns: 'common' })}
        </Button>
        <Button type="button" className="w-full" onClick={props.onCancel}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
      </div>
    </Form>
  )
}
