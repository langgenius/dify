'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Countdown from '@/app/components/signin/countdown'
import { useAccountDeleteStore, useConfirmDeleteAccount, useSendDeleteAccountEmail } from '../state'

const CODE_EXP = /[A-Z\d]{6}/gi

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function VerifyEmail(props: DeleteAccountProps) {
  const { t } = useTranslation()
  const emailToken = useAccountDeleteStore(state => state.sendEmailToken)
  const [verificationCode, setVerificationCode] = useState<string>()
  const [shouldButtonDisabled, setShouldButtonDisabled] = useState(true)
  const { mutate: sendEmail } = useSendDeleteAccountEmail()
  const { isPending: isDeleting, mutateAsync: confirmDeleteAccount } = useConfirmDeleteAccount()

  useEffect(() => {
    setShouldButtonDisabled(!(verificationCode && CODE_EXP.test(verificationCode)) || isDeleting)
  }, [verificationCode, isDeleting])

  const handleConfirm = useCallback(async () => {
    try {
      const ret = await confirmDeleteAccount({ code: verificationCode!, token: emailToken })
      if (ret.result === 'success')
        props.onConfirm()
    }
    catch (error) { console.error(error) }
  }, [emailToken, verificationCode, confirmDeleteAccount, props])
  return (
    <>
      <div className="body-md-medium pt-1 text-text-destructive">
        {t('account.deleteTip', { ns: 'common' })}
      </div>
      <div className="body-md-regular pb-2 pt-1 text-text-secondary">
        {t('account.deletePrivacyLinkTip', { ns: 'common' })}
        <Link href="https://dify.ai/privacy" className="text-text-accent">{t('account.deletePrivacyLink', { ns: 'common' })}</Link>
      </div>
      <label className="system-sm-semibold mb-1 mt-3 flex h-6 items-center text-text-secondary">{t('account.verificationLabel', { ns: 'common' })}</label>
      <Input
        minLength={6}
        maxLength={6}
        placeholder={t('account.verificationPlaceholder', { ns: 'common' }) as string}
        onChange={(e) => {
          setVerificationCode(e.target.value)
        }}
      />
      <div className="mt-3 flex w-full flex-col gap-2">
        <Button className="w-full" disabled={shouldButtonDisabled} loading={isDeleting} variant="warning" onClick={handleConfirm}>{t('account.permanentlyDeleteButton', { ns: 'common' })}</Button>
        <Button className="w-full" onClick={props.onCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Countdown onResend={sendEmail} />
      </div>
    </>
  )
}
