import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { submitHumanInputFormMutationOptions } from '@/service/share-queries'

export const useFormSubmit = (token: string) => {
  const [success, setSuccess] = useState(false)
  const { mutate: submitForm, isPending: isSubmitting } = useMutation(
    submitHumanInputFormMutationOptions(),
  )

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
