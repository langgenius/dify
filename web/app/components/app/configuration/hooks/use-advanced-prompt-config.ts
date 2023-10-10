import { useState } from 'react'
import type { ChatPromptConfig, CompletionPromptConfig, ConversationHistoriesRole, PromptItem } from '@/models/debug'
import { PromptMode } from '@/models/debug'
import { ModelModeType } from '@/types/app'

type Param = {
  promptMode: PromptMode
  modelModeType: ModelModeType
}
const useAdvancedPromptConfig = ({
  promptMode,
  modelModeType,
}: Param) => {
  const [chatPromptConfig, setChatPromptConfig] = useState<ChatPromptConfig>({
    prompt: [],
  })
  const [completionPromptConfig, setCompletionPromptConfig] = useState<CompletionPromptConfig>({
    prompt: {
      text: '',
    },
    conversation_histories_role: {
      user_prefix: '',
      assistant_prefix: '',
    },
  })

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
  return {
    chatPromptConfig,
    completionPromptConfig,
    currentAdvancedPrompt,
    setCurrentAdvancedPrompt,
    setConversationHistoriesRole,
  }
}

export default useAdvancedPromptConfig
