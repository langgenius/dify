'use client'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useState } from 'react'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import Countdown from '@/app/components/signin/countdown'

const CODE_EXP = /\d{6}/gi

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function VerifyEmail(props: DeleteAccountProps) {
  const { t } = useTranslation()
  const [verificationCode, setVerificationCode] = useState<string>()
  const [shouldButtonDisabled, setShouldButtonDisabled] = useState(true)

  useEffect(() => {
    setShouldButtonDisabled(!(verificationCode && CODE_EXP.test(verificationCode)))
  }, [verificationCode])

  const resendVerifyCode = useCallback(() => {

  }, [])

  return <div className='flex flex-col gap-4'>
    <div className='text-text-destructive body-md-medium'>
      {t('common.account.deleteTip')}
    </div>
    <label className='system-sm-semibold text-text-secondary'>{t('common.account.verificationLabel')}</label>
    <div>
      <Input minLength={6} maxLength={6} placeholder={t('common.account.verificationPlaceholder') as string} onChange={(e) => {
        setVerificationCode(e.target.value)
      }} />
    </div>
    <div className='w-full flex flex-col gap-2 pb-6'>
      <Button className='w-full' disabled={shouldButtonDisabled} variant='warning' onClick={props.onConfirm}>{t('common.account.permanentlyDeleteButton')}</Button>
      <Button className='w-full' onClick={props.onCancel}>{t('common.operation.cancel')}</Button>
      <Countdown onResend={resendVerifyCode} />
    </div>
  </div>
}
