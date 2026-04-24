import type { SubmittedHumanInputContentProps } from './type'
import { useMemo } from 'react'
import ExecutedAction from './executed-action'
import SubmittedContent from './submitted-content'
import SubmittedFieldValues from './submitted-field-values'
import SubmittedFormContent from './submitted-form-content'

export const SubmittedHumanInputContent = ({
  formData,
}: SubmittedHumanInputContentProps) => {
  const { rendered_content, action_id, action_text, form_content, form_data, inputs } = formData

  const executedAction = useMemo(() => {
    return {
      id: action_id,
      title: action_text,
    }
  }, [action_id, action_text])

  const content = form_content && inputs && form_data && Object.keys(form_data).length > 0
    ? (
        <SubmittedFormContent
          formContent={form_content}
          formInputFields={inputs}
          values={form_data}
        />
      )
    : form_data && Object.keys(form_data).length > 0
      ? <SubmittedFieldValues values={form_data} />
      : <SubmittedContent content={rendered_content} />

  return (
    <>
      {content}
      {/* Executed Action */}
      <ExecutedAction executedAction={executedAction} />
    </>
  )
}
