'use client'
import type { FC } from 'react'
import React from 'react'
import SimplePromptInput from './simple-prompt-input'
import { PromptMode } from '@/models/debug'
import type { PromptVariable } from '@/models/debug'
import type { AppType } from '@/types/app'

export type IPromptProps = {
  promptMode?: PromptMode
  mode: AppType
  promptTemplate: string
  promptVariables: PromptVariable[]
  readonly?: boolean
  onChange?: (promp: string, promptVariables: PromptVariable[]) => void
}

const Prompt: FC<IPromptProps> = ({
  mode,
  promptMode = PromptMode.simple,
  promptTemplate,
  promptVariables,
  readonly = false,
  onChange,
}) => {
  if (promptMode === PromptMode.simple) {
    return (
      <SimplePromptInput
        mode={mode}
        promptTemplate={promptTemplate}
        promptVariables={promptVariables}
        readonly={readonly}
        onChange={onChange}
      />)
  }

  return (
    <div>Advanced Prompt input</div>
  )
}

export default React.memo(Prompt)
