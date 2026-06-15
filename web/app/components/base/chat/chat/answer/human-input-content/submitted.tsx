import type { SubmittedHumanInputContentProps } from './type'
import { useMemo } from 'react'
import ExecutedAction from './executed-action'
import SubmittedContent from './submitted-content'
import SubmittedFieldValues from './submitted-field-values'
import SubmittedFormContent from './submitted-form-content'

export const SubmittedHumanInputContent = ({
  formData,
}: SubmittedHumanInputContentProps) => {
  const { rendered_content, action_id, action_text, form_content, submitted_data, inputs } = formData

  const executedAction = useMemo(() => {
    return {
      id: action_id,
      title: action_text,
    }
  }, [action_id, action_text])

  const content = form_content && inputs && submitted_data && Object.keys(submitted_data).length > 0
    ? (
        <SubmittedFormContent
          formContent={form_content}
          formInputFields={inputs}
          values={submitted_data}
        />
      )
    : submitted_data && Object.keys(submitted_data).length > 0
      ? <SubmittedFieldValues values={submitted_data} />
      : <SubmittedContent content={rendered_content} />

  return (
    <>
      {content}
      {/* Executed Action */}
      <ExecutedAction executedAction={executedAction} />
    </>
  )
}
