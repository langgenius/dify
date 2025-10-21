import { useState } from 'react'
import { clone } from 'lodash-es'
import { produce } from 'immer'
import type { ChatPromptConfig, CompletionPromptConfig, ConversationHistoriesRole, PromptItem } from '@/models/debug'
import { PromptMode } from '@/models/debug'
import { ModelModeType } from '@/types/app'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { PRE_PROMPT_PLACEHOLDER_TEXT, checkHasContextBlock, checkHasHistoryBlock, checkHasQueryBlock } from '@/app/components/base/prompt-editor/constants'
import { fetchPromptTemplate } from '@/service/debug'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'

type Param = {
  appMode: string
  modelModeType: ModelModeType
  modelName: string
  promptMode: PromptMode
  prePrompt: string
  onUserChangedPrompt: () => void
  hasSetDataSet: boolean
  completionParams: FormValue
  setCompletionParams: (params: FormValue) => void
  setStop: (stop: string[]) => void
}

const useAdvancedPromptConfig = ({
  appMode,
  modelModeType,
  modelName,
  promptMode,
  prePrompt,
  onUserChangedPrompt,
  hasSetDataSet,
  completionParams,
  setCompletionParams,
  setStop,
}: Param) => {
  const isAdvancedPrompt = promptMode === PromptMode.advanced
  const [chatPromptConfig, setChatPromptConfig] = useState<ChatPromptConfig>(() => clone(DEFAULT_CHAT_PROMPT_CONFIG))
  const [completionPromptConfig, setCompletionPromptConfig] = useState<CompletionPromptConfig>(() => clone(DEFAULT_COMPLETION_PROMPT_CONFIG))

  const currentAdvancedPrompt = (() => {
    if (!isAdvancedPrompt)
      return []

    return (modelModeType === ModelModeType.chat) ? chatPromptConfig.prompt : completionPromptConfig.prompt
  })()

  const setCurrentAdvancedPrompt = (prompt: PromptItem | PromptItem[], isUserChanged?: boolean) => {
    if (!isAdvancedPrompt)
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
    if (isUserChanged)
      onUserChangedPrompt()
  }

  const setConversationHistoriesRole = (conversationHistoriesRole: ConversationHistoriesRole) => {
    setCompletionPromptConfig({
      ...completionPromptConfig,
      conversation_histories_role: conversationHistoriesRole,
    })
  }

  const hasSetBlockStatus = (() => {
    if (!isAdvancedPrompt) {
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
        query: !!chatPromptConfig.prompt.find(p => checkHasQueryBlock(p.text)),
      }
    }
    else {
      const prompt = completionPromptConfig.prompt?.text
      return {
        context: checkHasContextBlock(prompt),
        history: checkHasHistoryBlock(prompt),
        query: checkHasQueryBlock(prompt),
      }
    }
  })()

  /* prompt: simple to advanced process, or chat model to completion model
  * 1. migrate prompt
  * 2. change promptMode to advanced
  */
  const migrateToDefaultPrompt = async (isMigrateToCompetition?: boolean, toModelModeType?: ModelModeType) => {
    const mode = modelModeType
    const toReplacePrePrompt = prePrompt || ''
    if (!isAdvancedPrompt) {
      const { chat_prompt_config, completion_prompt_config, stop } = await fetchPromptTemplate({
        appMode,
        mode,
        modelName,
        hasSetDataSet,
      })
      if (modelModeType === ModelModeType.chat) {
        const newPromptConfig = produce(chat_prompt_config, (draft) => {
          draft.prompt = draft.prompt.map((p) => {
            return {
              ...p,
              text: p.text.replace(PRE_PROMPT_PLACEHOLDER_TEXT, toReplacePrePrompt),
            }
          })
        })
        setChatPromptConfig(newPromptConfig)
      }

      else {
        const newPromptConfig = produce(completion_prompt_config, (draft) => {
          draft.prompt.text = draft.prompt.text.replace(PRE_PROMPT_PLACEHOLDER_TEXT, toReplacePrePrompt)
        })
        setCompletionPromptConfig(newPromptConfig)
        setCompletionParams({
          ...completionParams,
          stop,
        })
      }
      return
    }

    if (isMigrateToCompetition) {
      const { completion_prompt_config, chat_prompt_config, stop } = await fetchPromptTemplate({
        appMode,
        mode: toModelModeType as ModelModeType,
        modelName,
        hasSetDataSet,
      })

      if (toModelModeType === ModelModeType.completion) {
        const newPromptConfig = produce(completion_prompt_config, (draft) => {
          if (!completionPromptConfig.prompt?.text)
            draft.prompt.text = draft.prompt.text.replace(PRE_PROMPT_PLACEHOLDER_TEXT, toReplacePrePrompt)

          else
            draft.prompt.text = completionPromptConfig.prompt?.text.replace(PRE_PROMPT_PLACEHOLDER_TEXT, toReplacePrePrompt)

          if (['advanced-chat', 'agent-chat', 'chat'].includes(appMode) && completionPromptConfig.conversation_histories_role.assistant_prefix && completionPromptConfig.conversation_histories_role.user_prefix)
            draft.conversation_histories_role = completionPromptConfig.conversation_histories_role
        })
        setCompletionPromptConfig(newPromptConfig)
        if (!completionParams.stop || completionParams.stop.length === 0) {
          setCompletionParams({
            ...completionParams,
            stop,
          })
        }
        setStop(stop) // switch mode's params is async. It may override the stop value.
      }
      else {
        const newPromptConfig = produce(chat_prompt_config, (draft) => {
          draft.prompt = draft.prompt.map((p) => {
            return {
              ...p,
              text: p.text.replace(PRE_PROMPT_PLACEHOLDER_TEXT, toReplacePrePrompt),
            }
          })
        })
        setChatPromptConfig(newPromptConfig)
      }
    }
  }

  return {
    chatPromptConfig,
    setChatPromptConfig,
    completionPromptConfig,
    setCompletionPromptConfig,
    currentAdvancedPrompt,
    setCurrentAdvancedPrompt,
    hasSetBlockStatus,
    setConversationHistoriesRole,
    migrateToDefaultPrompt,
  }
}

export default useAdvancedPromptConfig
