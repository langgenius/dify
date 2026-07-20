import { useCallback, useState } from 'react'
import { useSubmitHumanInputForm } from '@/service/use-share'

export const useFormSubmit = (token: string) => {
  const [success, setSuccess] = useState(false)
  const { mutate: submitForm, isPending: isSubmitting } = useSubmitHumanInputForm()

  const submit = useCallback(
    (inputs: Record<string, unknown> | undefined, actionID: string) => {
      submitForm(
        {
          token,
          data: {
            inputs: inputs || {},
            action: actionID,
          },
        },
        {
          onSuccess: () => {
            setSuccess(true)
          },
        },
      )
    },
    [submitForm, token],
  )

  return {
    isSubmitting,
    submit,
    success,
  }
}
