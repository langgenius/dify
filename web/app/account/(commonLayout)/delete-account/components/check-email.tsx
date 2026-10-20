'use client'
import { Button } from '@langgenius/dify-ui/button'
import { DialogBody, DialogFooter } from '@langgenius/dify-ui/dialog'
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
  const { t } = useTranslation(['common', 'accountSettings'])
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
      className="contents"
      onFormSubmit={() => {
        void handleConfirm()
      }}
    >
      <DialogBody>
        <div className="py-1 body-md-medium text-text-destructive">
          {t(($) => $['account.deleteTip'], { ns: 'accountSettings' })}
        </div>
        <div className="pt-1 pb-2 body-md-regular text-text-secondary">
          {t(($) => $['account.deletePrivacyLinkTip'], { ns: 'accountSettings' })}
          <Link href="https://dify.ai/privacy" className="text-text-accent">
            {t(($) => $['account.deletePrivacyLink'], { ns: 'accountSettings' })}
          </Link>
        </div>
        <Field name="email" className="mt-3">
          <FieldLabel className="system-sm-semibold">
            {t(($) => $['account.deleteLabel'], { ns: 'accountSettings' })}
          </FieldLabel>
          <Input
            placeholder={
              t(($) => $['account.deletePlaceholder'], { ns: 'accountSettings' }) as string
            }
            value={userInputEmail}
            onValueChange={setUserInputEmail}
          />
        </Field>
      </DialogBody>
      <DialogFooter className="flex-col items-stretch">
        <Button
          type="submit"
          disabled={userInputEmail !== userProfileEmail}
          loading={isSendingEmail}
          variant="primary"
        >
          {t(($) => $['account.sendVerificationButton'], { ns: 'accountSettings' })}
        </Button>
        <Button type="button" onClick={props.onCancel}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}
