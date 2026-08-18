'use client'
import type { FC } from 'react'
import type { WorkflowVariableBlockType } from '@/app/components/base/prompt-editor/types'
import * as React from 'react'
import PromptEditor from '@/app/components/base/prompt-editor'

type Props = Readonly<{
  value: string
  workflowVariableBlock: WorkflowVariableBlockType
}>

const PromptRes: FC<Props> = ({ value, workflowVariableBlock }) => {
  return (
    <PromptEditor
      key={value}
      value={value}
      editable={false}
      className="h-full bg-transparent pt-0"
      workflowVariableBlock={workflowVariableBlock}
    />
  )
}
export default React.memo(PromptRes)
