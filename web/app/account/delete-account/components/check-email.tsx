'use client'
import { useTranslation } from 'react-i18next'
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useSendDeleteAccountEmail } from '../state'
import { useAppContext } from '@/context/app-context'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function CheckEmail(props: DeleteAccountProps) {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const [userInputEmail, setUserInputEmail] = useState('')

  const { isPending: isSendingEmail, mutateAsync: getDeleteEmailVerifyCode } = useSendDeleteAccountEmail()

  const handleConfirm = useCallback(async () => {
    try {
      const ret = await getDeleteEmailVerifyCode()
      if (ret.result === 'success')
        props.onConfirm()
    }
    catch (error) { console.error(error) }
  }, [getDeleteEmailVerifyCode, props])

  return <>
    <div className='body-md-medium py-1 text-text-destructive'>
      {t('common.account.deleteTip')}
    </div>
    <div className='body-md-regular pb-2 pt-1 text-text-secondary'>
      {t('common.account.deletePrivacyLinkTip')}
      <Link href='https://dify.ai/privacy' className='text-text-accent'>{t('common.account.deletePrivacyLink')}</Link>
    </div>
    <label className='system-sm-semibold mb-1 mt-3 flex h-6 items-center text-text-secondary'>{t('common.account.deleteLabel')}</label>
    <Input placeholder={t('common.account.deletePlaceholder') as string} onChange={(e) => {
      setUserInputEmail(e.target.value)
    }} />
    <div className='mt-3 flex w-full flex-col gap-2'>
      <Button className='w-full' disabled={userInputEmail !== userProfile.email || isSendingEmail} loading={isSendingEmail} variant='primary' onClick={handleConfirm}>{t('common.account.sendVerificationButton')}</Button>
      <Button className='w-full' onClick={props.onCancel}>{t('common.operation.cancel')}</Button>
    </div>
  </>
}
