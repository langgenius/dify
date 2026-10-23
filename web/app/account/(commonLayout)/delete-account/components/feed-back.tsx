'use client'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
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
  const { t } = useTranslation(['common', 'accountSettings'])
  const { data: userProfileEmail } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const { isPending, mutateAsync: sendFeedback } = useDeleteAccountFeedback()

  const { mutateAsync: logout } = useLogout({ redirectTo: '/signin?account_deleted=true' })
  const handleSuccess = useCallback(async () => {
    try {
      await logout()
    } catch (error) {
      console.error(error)
    }
  }, [logout])

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
        backdropProps={{ className: 'bg-background-overlay-backdrop backdrop-blur-[6px]' }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['account.feedbackTitle'], { ns: 'accountSettings' })}
          </DialogTitle>
        </DialogHeader>
        <Form<FeedbackFormValues>
          className="contents"
          onFormSubmit={({ feedback }) => {
            void handleSubmit(feedback)
          }}
        >
          <DialogBody>
            <Field name="feedback" className="gap-0">
              <FieldLabel className="system-sm-semibold">
                {t(($) => $['account.feedbackLabel'], { ns: 'accountSettings' })}
              </FieldLabel>
              <Textarea
                rows={6}
                placeholder={
                  t(($) => $['account.feedbackPlaceholder'], { ns: 'accountSettings' }) as string
                }
              />
            </Field>
          </DialogBody>
          <DialogFooter className="flex-col items-stretch">
            <Button type="submit" loading={isPending} variant="primary">
              {t(($) => $['operation.submit'], { ns: 'common' })}
            </Button>
            <Button type="button" onClick={handleSkip}>
              {t(($) => $['operation.skip'], { ns: 'common' })}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
