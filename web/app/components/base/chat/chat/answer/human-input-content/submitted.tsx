import type { SubmittedHumanInputContentProps } from './type'
import { useMemo } from 'react'
import ExecutedAction from './executed-action'
import SubmittedContent from './submitted-content'

export const SubmittedHumanInputContent = ({
  formData,
}: SubmittedHumanInputContentProps) => {
  const { rendered_content, action_id, action_text } = formData

  const executedAction = useMemo(() => {
    return {
      id: action_id,
      title: action_text,
    }
  }, [action_id, action_text])

  return (
    <>
      <SubmittedContent content={rendered_content} />
      {/* Executed Action */}
      <ExecutedAction executedAction={executedAction} />
    </>
  )
}
