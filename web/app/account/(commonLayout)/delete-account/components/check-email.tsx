'use client'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { Button } from '@/app/components/base/ui/button'
import { useAppContext } from '@/context/app-context'
import Link from '@/next/link'
import { useSendDeleteAccountEmail } from '../state'

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

  return (
    <>
      <div className="py-1 body-md-medium text-text-destructive">
        {t('account.deleteTip', { ns: 'common' })}
      </div>
      <div className="pt-1 pb-2 body-md-regular text-text-secondary">
        {t('account.deletePrivacyLinkTip', { ns: 'common' })}
        <Link href="https://dify.ai/privacy" className="text-text-accent">{t('account.deletePrivacyLink', { ns: 'common' })}</Link>
      </div>
      <label className="mt-3 mb-1 flex h-6 items-center system-sm-semibold text-text-secondary">{t('account.deleteLabel', { ns: 'common' })}</label>
      <Input
        placeholder={t('account.deletePlaceholder', { ns: 'common' }) as string}
        onChange={(e) => {
          setUserInputEmail(e.target.value)
        }}
      />
      <div className="mt-3 flex w-full flex-col gap-2">
        <Button className="w-full" disabled={userInputEmail !== userProfile.email || isSendingEmail} loading={isSendingEmail} variant="primary" onClick={handleConfirm}>{t('account.sendVerificationButton', { ns: 'common' })}</Button>
        <Button className="w-full" onClick={props.onCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
      </div>
    </>
  )
}
