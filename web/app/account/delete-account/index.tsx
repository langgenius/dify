'use client'
import { useTranslation } from 'react-i18next'
import { useCallback, useState } from 'react'
import CheckEmail from './components/check-email'
import VerifyEmail from './components/verify-email'
import FeedBack from './components/feed-back'
import CustomDialog from '@/app/components/base/dialog'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/countdown'

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

  return <CustomDialog
    show={true}
    onClose={props.onCancel}
    title={t('common.account.delete')}
    className="max-w-[480px]"
    footer={false}
  >
    {!showVerifyEmail && <CheckEmail onCancel={props.onCancel} onConfirm={handleEmailCheckSuccess} />}
    {showVerifyEmail && <VerifyEmail onCancel={props.onCancel} onConfirm={() => {
      setShowFeedbackDialog(true)
    }} />}
  </CustomDialog>
}
