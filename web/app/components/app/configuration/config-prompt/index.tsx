'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import SimplePromptInput from './simple-prompt-input'
import AdvancedMessageInput from '@/app/components/app/configuration/config-prompt/advanced-prompt-input'
import { PromptMode } from '@/models/debug'
import type { PromptVariable } from '@/models/debug'
import type { AppType } from '@/types/app'
import ConfigContext from '@/context/debug-configuration'

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
  const {
    messageList = [],
    setMessageList,
  } = useContext(ConfigContext)

  const handleMessageTypeChange = (index: number, type: string) => {
    const newMessageList = produce(messageList, (draft) => {
      draft[index].type = type
    })
    setMessageList(newMessageList)
  }

  const handleMessageDelete = (index: number) => {
    const newMessageList = produce(messageList, (draft) => {
      draft.splice(index, 1)
    })
    setMessageList(newMessageList)
  }

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
    <div>
      <div className='space-y-3'>
        {messageList.map((item, index) => (
          <AdvancedMessageInput
            key={index}
            type={item.type}
            message={item.message}
            onTypeChange={type => handleMessageTypeChange(index, type)}
            canDelete={messageList.length > 1}
            onDelete={() => handleMessageDelete(index)}
          />
        ))}
      </div>
      <div className='mt-3 flex items-center h-8 justify-center bg-gray-50 cursor-pointer text-[13px] font-medium text-gray-700 space-x-2'>Add Message</div>
    </div>
  )
}

export default React.memo(Prompt)
