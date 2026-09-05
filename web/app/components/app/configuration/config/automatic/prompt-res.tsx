'use client'
import type { FC } from 'react'
import type { WorkflowVariableBlockType } from '@/app/components/base/prompt-editor/types'
import * as React from 'react'
import PromptEditor from '@/app/components/base/prompt-editor'

type Props = Readonly<{
  value: string
  workflowVariableBlock: WorkflowVariableBlockType
}>

const keyIdPrefix = 'prompt-res-editor'
const PromptRes: FC<Props> = ({ value, workflowVariableBlock }) => {
  const [prevValue, setPrevValue] = React.useState(value)
  const [editorKey, setEditorKey] = React.useState(0)
  // Adjust state during render (instead of in an effect) so the editor is
  // remounted with a fresh key exactly when the prompt value changes.
  if (prevValue !== value) {
    setPrevValue(value)
    setEditorKey((key) => key + 1)
  }
  return (
    <PromptEditor
      key={`${keyIdPrefix}-${editorKey}`}
      value={value}
      editable={false}
      className="h-full bg-transparent pt-0"
      workflowVariableBlock={workflowVariableBlock}
    />
  )
}
export default React.memo(PromptRes)
