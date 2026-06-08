import type { LLMNodeType } from '../types'
import type {
  PromptItem,
  RolePrefix,
} from '@/app/components/workflow/types'
import { produce } from 'immer'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

type CompletionPromptTemplate = {
  prompt: PromptItem
  conversation_histories_role: {
    user_prefix: string
    assistant_prefix: string
  }
}

export type LLMDefaultConfig = {
  prompt_templates?: {
    chat_model: {
      prompts: PromptItem[]
    }
    completion_model: CompletionPromptTemplate
  }
}

type Params = {
  inputs: LLMNodeType
  doSetInputs: (inputs: LLMNodeType) => void
  defaultConfig?: LLMDefaultConfig
  isChatModel: boolean
}

const useLLMInputManager = ({
  inputs,
  doSetInputs,
  defaultConfig,
  isChatModel,
}: Params) => {
  const [defaultRolePrefix, setDefaultRolePrefix] = useState<RolePrefix>({ user: '', assistant: '' })
  const inputRef = useRef(inputs)

  useEffect(() => {
    inputRef.current = inputs
  }, [inputs])

  const setInputs = useCallback((newInputs: LLMNodeType) => {
    if (newInputs.memory && !newInputs.memory.role_prefix) {
      const payloadWithRolePrefix = produce(newInputs, (draft) => {
        draft.memory!.role_prefix = defaultRolePrefix
      })
      doSetInputs(payloadWithRolePrefix)
      inputRef.current = payloadWithRolePrefix
      return
    }

    doSetInputs(newInputs)
    inputRef.current = newInputs
  }, [defaultRolePrefix, doSetInputs])

  const appendDefaultPromptConfig = useCallback((draft: LLMNodeType, nextDefaultConfig: LLMDefaultConfig, passInIsChatMode?: boolean) => {
    const promptTemplates = nextDefaultConfig.prompt_templates
    if (!promptTemplates)
      return

    if (passInIsChatMode === undefined ? isChatModel : passInIsChatMode) {
      draft.prompt_template = promptTemplates.chat_model.prompts
      return
    }

    draft.prompt_template = promptTemplates.completion_model.prompt
    setDefaultRolePrefix({
      user: promptTemplates.completion_model.conversation_histories_role.user_prefix,
      assistant: promptTemplates.completion_model.conversation_histories_role.assistant_prefix,
    })
  }, [isChatModel])

  useEffect(() => {
    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0
    if (!isReady || inputs.prompt_template)
      return

    const nextInputs = produce(inputs, (draft) => {
      appendDefaultPromptConfig(draft, defaultConfig)
    })
    setInputs(nextInputs)
  }, [appendDefaultPromptConfig, defaultConfig, inputs, setInputs])

  return {
    inputRef,
    setInputs,
    appendDefaultPromptConfig,
  }
}

export default useLLMInputManager
