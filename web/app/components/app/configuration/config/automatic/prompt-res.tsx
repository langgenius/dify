'use client'
import PromptEditor from '@/app/components/base/prompt-editor'
import type { WorkflowVariableBlockType } from '@/app/components/base/prompt-editor/types'
import type { FC } from 'react'
import React from 'react'

type Props = {
  value: string
  workflowVariableBlock: WorkflowVariableBlockType
}

const PromptRes: FC<Props> = ({
  value,
  workflowVariableBlock,
}) => {
  return (
    <PromptEditor
      value={value}
      editable={false}
      className='h-full bg-transparent pt-0'
      workflowVariableBlock={workflowVariableBlock}
    />
  )
}
export default React.memo(PromptRes)
