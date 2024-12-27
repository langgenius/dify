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
    <div className='pt-1 text-text-destructive body-md-medium'>
      {t('common.account.deleteTip')}
    </div>
    <div className='pt-1 pb-2 text-text-secondary body-md-regular'>
      {t('common.account.deletePrivacyLinkTip')}
      <Link href='https://dify.ai/privacy' className='text-text-accent'>{t('common.account.deletePrivacyLink')}</Link>
    </div>
    <label className='mt-3 mb-1 h-6 flex items-center system-sm-semibold text-text-secondary'>{t('common.account.verificationLabel')}</label>
    <Input minLength={6} maxLength={6} placeholder={t('common.account.verificationPlaceholder') as string} onChange={(e) => {
      setVerificationCode(e.target.value)
    }} />
    <div className='w-full flex flex-col mt-3 gap-2'>
      <Button className='w-full' disabled={shouldButtonDisabled} loading={isDeleting} variant='warning' onClick={handleConfirm}>{t('common.account.permanentlyDeleteButton')}</Button>
      <Button className='w-full' onClick={props.onCancel}>{t('common.operation.cancel')}</Button>
      <Countdown onResend={sendEmail} />
    </div>
  </>
}
