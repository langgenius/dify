'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from '@/app/components/base/textarea'
import { useAppContext } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
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
      toast.info(t('account.deleteSuccessTip', { ns: 'common' }))
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          props.onCancel()
      }}
    >
      <DialogContent
        className="max-w-[480px] overflow-hidden!"
        backdropClassName="bg-background-overlay-backdrop backdrop-blur-[6px]"
      >
        <DialogTitle className="pr-8 pb-3 title-2xl-semi-bold text-text-primary">
          {t('account.feedbackTitle', { ns: 'common' })}
        </DialogTitle>
        <label className="mt-3 mb-1 flex items-center system-sm-semibold text-text-secondary">{t('account.feedbackLabel', { ns: 'common' })}</label>
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
      </DialogContent>
    </Dialog>
  )
}
