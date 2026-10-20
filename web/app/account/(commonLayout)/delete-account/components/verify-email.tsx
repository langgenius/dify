'use client'
import { Button } from '@langgenius/dify-ui/button'
import { DialogBody, DialogFooter } from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Countdown from '@/app/components/signin/countdown'
import Link from '@/next/link'
import { useAccountDeleteStore, useConfirmDeleteAccount, useSendDeleteAccountEmail } from '../state'

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

type VerifyEmailFormValues = {
  verificationCode: string
}

export default function VerifyEmail(props: DeleteAccountProps) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const emailToken = useAccountDeleteStore((state) => state.sendEmailToken)
  const { mutate: sendEmail } = useSendDeleteAccountEmail()
  const { isPending: isDeleting, mutateAsync: confirmDeleteAccount } = useConfirmDeleteAccount()

  const handleConfirm = useCallback(
    async (verificationCode: string) => {
      if (isDeleting) return

      try {
        const ret = await confirmDeleteAccount({ code: verificationCode, token: emailToken })
        if (ret.result === 'success') props.onConfirm()
      } catch (error) {
        console.error(error)
      }
    },
    [emailToken, confirmDeleteAccount, isDeleting, props],
  )
  return (
    <Form<VerifyEmailFormValues>
      className="contents"
      onFormSubmit={({ verificationCode }) => {
        void handleConfirm(verificationCode)
      }}
    >
      <DialogBody>
        <div className="pt-1 body-md-medium text-text-destructive">
          {t(($) => $['account.deleteTip'], { ns: 'accountSettings' })}
        </div>
        <div className="pt-1 pb-2 body-md-regular text-text-secondary">
          {t(($) => $['account.deletePrivacyLinkTip'], { ns: 'accountSettings' })}
          <Link href="https://dify.ai/privacy" className="text-text-accent">
            {t(($) => $['account.deletePrivacyLink'], { ns: 'accountSettings' })}
          </Link>
        </div>
        <Field name="verificationCode" className="mt-3">
          <FieldLabel className="system-sm-semibold">
            {t(($) => $['account.verificationLabel'], { ns: 'accountSettings' })}
          </FieldLabel>
          <Input
            autoComplete="one-time-code"
            inputMode="numeric"
            required
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            placeholder={
              t(($) => $['account.verificationPlaceholder'], { ns: 'accountSettings' }) as string
            }
          />
          <FieldError match="valueMissing">
            {t(($) => $['account.verificationPlaceholder'], { ns: 'accountSettings' })}
          </FieldError>
          <FieldError match="patternMismatch">
            {t(($) => $['account.verificationPlaceholder'], { ns: 'accountSettings' })}
          </FieldError>
        </Field>
      </DialogBody>
      <DialogFooter className="flex-col items-stretch">
        <Button type="submit" loading={isDeleting} variant="primary" tone="destructive">
          {t(($) => $['account.permanentlyDeleteButton'], { ns: 'accountSettings' })}
        </Button>
        <Button onClick={props.onCancel}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Countdown onResend={sendEmail} />
      </DialogFooter>
    </Form>
  )
}
