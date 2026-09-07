'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useRouter } from '@/next/navigation'
import { useLogout } from '@/service/use-common'
import { useDeleteAccountFeedback } from '../state'

type DeleteAccountProps = {
  onCancel: () => void
  onConfirm: () => void
}

type FeedbackFormValues = {
  feedback: string
}

export default function FeedBack(props: DeleteAccountProps) {
  const { t } = useTranslation()
  const { data: userProfileEmail } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const router = useRouter()
  const { isPending, mutateAsync: sendFeedback } = useDeleteAccountFeedback()

  const { mutateAsync: logout } = useLogout()
  const handleSuccess = useCallback(async () => {
    try {
      await logout()
      // Tokens are now stored in cookies and cleared by backend
      router.push('/signin')
      toast.info(t(($) => $['account.deleteSuccessTip'], { ns: 'common' }))
    } catch (error) {
      console.error(error)
    }
  }, [logout, router, t])

  const handleSubmit = useCallback(
    async (feedback: string) => {
      try {
        await sendFeedback({ feedback, email: userProfileEmail })
        props.onConfirm()
        await handleSuccess()
      } catch (error) {
        console.error(error)
      }
    },
    [handleSuccess, sendFeedback, userProfileEmail, props],
  )

  const handleSkip = useCallback(() => {
    props.onCancel()
    handleSuccess()
  }, [handleSuccess, props])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel()
      }}
    >
      <DialogContent
        className="max-w-120 overflow-hidden!"
        backdropProps={{ className: 'bg-background-overlay-backdrop backdrop-blur-[6px]' }}
      >
        <DialogTitle className="pr-8 pb-3 title-2xl-semi-bold text-text-primary">
          {t(($) => $['account.feedbackTitle'], { ns: 'common' })}
        </DialogTitle>
        <Form<FeedbackFormValues>
          onFormSubmit={({ feedback }) => {
            void handleSubmit(feedback)
          }}
        >
          <Field name="feedback" className="mt-3">
            <FieldLabel className="py-0 system-sm-semibold">
              {t(($) => $['account.feedbackLabel'], { ns: 'common' })}
            </FieldLabel>
            <Textarea
              rows={6}
              placeholder={t(($) => $['account.feedbackPlaceholder'], { ns: 'common' }) as string}
            />
          </Field>
          <div className="mt-3 flex w-full flex-col gap-2">
            <Button type="submit" className="w-full" loading={isPending} variant="primary">
              {t(($) => $['operation.submit'], { ns: 'common' })}
            </Button>
            <Button type="button" className="w-full" onClick={handleSkip}>
              {t(($) => $['operation.skip'], { ns: 'common' })}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
