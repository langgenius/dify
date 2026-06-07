import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { useCallback, useState } from 'react'
import { getProcessedHumanInputFormInputs } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { useSubmitHumanInputForm } from '@/service/use-share'

export const useFormSubmit = (token: string) => {
  const [success, setSuccess] = useState(false)
  const { mutate: submitForm, isPending: isSubmitting } = useSubmitHumanInputForm()

  const submit = useCallback((inputs: Record<string, HumanInputFieldValue>, actionID: string, formInputs: FormInputItem[]) => {
    submitForm(
      {
        token,
        data: {
          inputs: getProcessedHumanInputFormInputs(formInputs, inputs) || {},
          action: actionID,
        },
      },
      {
        onSuccess: () => {
          setSuccess(true)
        },
      },
    )
  }, [submitForm, token])

  return {
    isSubmitting,
    submit,
    success,
  }
}
