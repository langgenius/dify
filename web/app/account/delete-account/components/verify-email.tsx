'use client'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAccountDeleteStore, useConfirmDeleteAccount, useSendDeleteAccountEmail } from '../state'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import Countdown from '@/app/components/signin/countdown'

const CODE_EXP = /[A-Za-z\d]{6}/gi

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
  return <>
    <div className='text-text-destructive body-md-medium pt-1'>
      {t('common.account.deleteTip')}
    </div>
    <div className='text-text-secondary body-md-regular pb-2 pt-1'>
      {t('common.account.deletePrivacyLinkTip')}
      <Link href='https://dify.ai/privacy' className='text-text-accent'>{t('common.account.deletePrivacyLink')}</Link>
    </div>
    <label className='system-sm-semibold text-text-secondary mb-1 mt-3 flex h-6 items-center'>{t('common.account.verificationLabel')}</label>
    <Input minLength={6} maxLength={6} placeholder={t('common.account.verificationPlaceholder') as string} onChange={(e) => {
      setVerificationCode(e.target.value)
    }} />
    <div className='mt-3 flex w-full flex-col gap-2'>
      <Button className='w-full' disabled={shouldButtonDisabled} loading={isDeleting} variant='warning' onClick={handleConfirm}>{t('common.account.permanentlyDeleteButton')}</Button>
      <Button className='w-full' onClick={props.onCancel}>{t('common.operation.cancel')}</Button>
      <Countdown onResend={sendEmail} />
    </div>
  </>
}
