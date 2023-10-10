import { useState } from 'react'
import { clone } from 'lodash-es'
import type { ChatPromptConfig, CompletionPromptConfig, ConversationHistoriesRole, PromptItem } from '@/models/debug'
import { PromptMode } from '@/models/debug'
import { ModelModeType } from '@/types/app'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { checkHasContextBlock, checkHasHistoryBlock, checkHasQueryBlock } from '@/app/components/base/prompt-editor/constants'

type Param = {
  promptMode: PromptMode
  prePrompt: string
  modelModeType: ModelModeType
}

const useAdvancedPromptConfig = ({
  promptMode,
  prePrompt,
  modelModeType,
}: Param) => {
  const [chatPromptConfig, setChatPromptConfig] = useState<ChatPromptConfig>(clone(DEFAULT_CHAT_PROMPT_CONFIG))
  const [completionPromptConfig, setCompletionPromptConfig] = useState<CompletionPromptConfig>(clone(DEFAULT_COMPLETION_PROMPT_CONFIG))

  const currentAdvancedPrompt = (() => {
    if (promptMode === PromptMode.simple)
      return []

    return (modelModeType === ModelModeType.chat) ? chatPromptConfig.prompt : completionPromptConfig.prompt
  })()

  const setCurrentAdvancedPrompt = (prompt: PromptItem | PromptItem[]) => {
    if (promptMode === PromptMode.simple)
      return

    if (modelModeType === ModelModeType.chat) {
      setChatPromptConfig({
        ...chatPromptConfig,
        prompt: prompt as PromptItem[],
      })
    }
    else {
      setCompletionPromptConfig({
        ...completionPromptConfig,
        prompt: prompt as PromptItem,
      })
    }
  }

  const setConversationHistoriesRole = (conversationHistoriesRole: ConversationHistoriesRole) => {
    setCompletionPromptConfig({
      ...completionPromptConfig,
      conversation_histories_role: conversationHistoriesRole,
    })
  }

  const hasSetBlockStatus = (() => {
    if (promptMode === PromptMode.simple) {
      return {
        context: checkHasContextBlock(prePrompt),
        history: false,
        query: false,
      }
    }
    if (modelModeType === ModelModeType.chat) {
      return {
        context: !!chatPromptConfig.prompt.find(p => checkHasContextBlock(p.text)),
        history: false,
        query: false,
      }
    }
    else {
      const prompt = completionPromptConfig.prompt.text
      return {
        context: checkHasContextBlock(prompt),
        history: checkHasHistoryBlock(prompt),
        query: checkHasQueryBlock(prompt),
      }
    }
  })()

  return {
    chatPromptConfig,
    setChatPromptConfig,
    completionPromptConfig,
    setCompletionPromptConfig,
    currentAdvancedPrompt,
    setCurrentAdvancedPrompt,
    hasSetBlockStatus,
    setConversationHistoriesRole,
  }
}

export default useAdvancedPromptConfig
