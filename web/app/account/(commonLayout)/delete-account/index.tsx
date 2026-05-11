'use client'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/countdown'
import CheckEmail from './components/check-email'
import FeedBack from './components/feed-back'
import VerifyEmail from './components/verify-email'

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

export default function DeleteAccount(props: DeleteAccountProps) {
  const { t } = useTranslation()

  const [showVerifyEmail, setShowVerifyEmail] = useState(false)
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false)

  const handleEmailCheckSuccess = useCallback(async () => {
    try {
      setShowVerifyEmail(true)
      localStorage.setItem(COUNT_DOWN_KEY, `${COUNT_DOWN_TIME_MS}`)
    }
    catch (error) { console.error(error) }
  }, [])

  if (showFeedbackDialog)
    return <FeedBack onCancel={props.onCancel} onConfirm={props.onConfirm} />

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
          {t('account.delete', { ns: 'common' })}
        </DialogTitle>
        {!showVerifyEmail && <CheckEmail onCancel={props.onCancel} onConfirm={handleEmailCheckSuccess} />}
        {showVerifyEmail && (
          <VerifyEmail
            onCancel={props.onCancel}
            onConfirm={() => {
              setShowFeedbackDialog(true)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
