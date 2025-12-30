'use client'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import CustomDialog from '@/app/components/base/dialog'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { useLogout } from '@/service/use-common'
import { useDeleteAccountFeedback } from '../state'

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function FeedBack(props: DeleteAccountProps) {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const router = useRouter()
  const [userFeedback, setUserFeedback] = useState('')
  const { isPending, mutateAsync: sendFeedback } = useDeleteAccountFeedback()

  const { mutateAsync: logout } = useLogout()
  const handleSuccess = useCallback(async () => {
    try {
      await logout()
      // Tokens are now stored in cookies and cleared by backend
      router.push('/signin')
      Toast.notify({ type: 'info', message: t('account.deleteSuccessTip', { ns: 'common' }) })
    }
    catch (error) { console.error(error) }
  }, [router, t])

  const handleSubmit = useCallback(async () => {
    try {
      await sendFeedback({ feedback: userFeedback, email: userProfile.email })
      props.onConfirm()
      await handleSuccess()
    }
    catch (error) { console.error(error) }
  }, [handleSuccess, userFeedback, sendFeedback, userProfile, props])

  const handleSkip = useCallback(() => {
    props.onCancel()
    handleSuccess()
  }, [handleSuccess, props])
  return (
    <CustomDialog
      show={true}
      onClose={props.onCancel}
      title={t('account.feedbackTitle', { ns: 'common' })}
      className="max-w-[480px]"
      footer={false}
    >
      <label className="system-sm-semibold mb-1 mt-3 flex items-center text-text-secondary">{t('account.feedbackLabel', { ns: 'common' })}</label>
      <Textarea
        rows={6}
        value={userFeedback}
        placeholder={t('account.feedbackPlaceholder', { ns: 'common' }) as string}
        onChange={(e) => {
          setUserFeedback(e.target.value)
        }}
      />
      <div className="mt-3 flex w-full flex-col gap-2">
        <Button className="w-full" loading={isPending} variant="primary" onClick={handleSubmit}>{t('operation.submit', { ns: 'common' })}</Button>
        <Button className="w-full" onClick={handleSkip}>{t('operation.skip', { ns: 'common' })}</Button>
      </div>
    </CustomDialog>
  )
}
