'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Countdown from '@/app/components/signin/countdown'
import Link from '@/next/link'
import { useAccountDeleteStore, useConfirmDeleteAccount, useSendDeleteAccountEmail } from '../state'

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function VerifyEmail(props: DeleteAccountProps) {
  const { t } = useTranslation()
  const emailToken = useAccountDeleteStore((state) => state.sendEmailToken)
  const [verificationCode, setVerificationCode] = useState('')
  const { mutate: sendEmail } = useSendDeleteAccountEmail()
  const { isPending: isDeleting, mutateAsync: confirmDeleteAccount } = useConfirmDeleteAccount()

  const handleConfirm = useCallback(async () => {
    if (isDeleting) return

    try {
      const ret = await confirmDeleteAccount({ code: verificationCode, token: emailToken })
      if (ret.result === 'success') props.onConfirm()
    } catch (error) {
      console.error(error)
    }
  }, [emailToken, verificationCode, confirmDeleteAccount, isDeleting, props])
  return (
    <Form
      onFormSubmit={() => {
        void handleConfirm()
      }}
    >
      <div className="pt-1 body-md-medium text-text-destructive">
        {t(($) => $['account.deleteTip'], { ns: 'common' })}
      </div>
      <div className="pt-1 pb-2 body-md-regular text-text-secondary">
        {t(($) => $['account.deletePrivacyLinkTip'], { ns: 'common' })}
        <Link href="https://dify.ai/privacy" className="text-text-accent">
          {t(($) => $['account.deletePrivacyLink'], { ns: 'common' })}
        </Link>
      </div>
      <Field name="verificationCode" className="mt-3">
        <FieldLabel className="system-sm-semibold">
          {t(($) => $['account.verificationLabel'], { ns: 'common' })}
        </FieldLabel>
        <Input
          autoComplete="one-time-code"
          inputMode="numeric"
          required
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          placeholder={t(($) => $['account.verificationPlaceholder'], { ns: 'common' }) as string}
          value={verificationCode}
          onValueChange={setVerificationCode}
        />
        <FieldError match="valueMissing">
          {t(($) => $['account.verificationPlaceholder'], { ns: 'common' })}
        </FieldError>
        <FieldError match="patternMismatch">
          {t(($) => $['account.verificationPlaceholder'], { ns: 'common' })}
        </FieldError>
      </Field>
      <div className="mt-3 flex w-full flex-col gap-2">
        <Button
          type="submit"
          className="w-full"
          loading={isDeleting}
          variant="primary"
          tone="destructive"
        >
          {t(($) => $['account.permanentlyDeleteButton'], { ns: 'common' })}
        </Button>
        <Button className="w-full" onClick={props.onCancel}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Countdown onResend={sendEmail} />
      </div>
    </Form>
  )
}
