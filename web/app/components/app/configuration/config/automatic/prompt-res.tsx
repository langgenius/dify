'use client'
import PromptEditor from '@/app/components/base/prompt-editor'
import type { WorkflowVariableBlockType } from '@/app/components/base/prompt-editor/types'
import type { FC } from 'react'
import React, { useEffect } from 'react'

type Props = {
  value: string
  workflowVariableBlock: WorkflowVariableBlockType
}

const keyIdPrefix = 'prompt-res-editor'
const PromptRes: FC<Props> = ({
  value,
  workflowVariableBlock,
}) => {
  const [editorKey, setEditorKey] = React.useState<string>('keyIdPrefix-0')
  useEffect(() => {
    setEditorKey(`${keyIdPrefix}-${Date.now()}`)
  }, [value])
  return (
    <PromptEditor
      key={editorKey}
      value={value}
      editable={false}
      className='h-full bg-transparent pt-0'
      workflowVariableBlock={workflowVariableBlock}
    />
  )
}
export default React.memo(PromptRes)
