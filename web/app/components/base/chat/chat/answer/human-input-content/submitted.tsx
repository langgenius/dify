import type { SubmittedHumanInputContentProps } from './type'
import { useMemo } from 'react'
import ExecutedAction from './executed-action'
import SubmittedContent from './submitted-content'
import SubmittedFieldValues from './submitted-field-values'

export const SubmittedHumanInputContent = ({
  formData,
}: SubmittedHumanInputContentProps) => {
  const { rendered_content, action_id, action_text, form_data } = formData

  const executedAction = useMemo(() => {
    return {
      id: action_id,
      title: action_text,
    }
  }, [action_id, action_text])

  return (
    <>
      {form_data && Object.keys(form_data).length > 0
        ? <SubmittedFieldValues values={form_data} />
        : <SubmittedContent content={rendered_content} />}
      {/* Executed Action */}
      <ExecutedAction executedAction={executedAction} />
    </>
  )
}
