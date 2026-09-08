import type { ModelConfig as BackendModelConfig } from '@/types/app'
import { clone } from 'es-toolkit/object'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'

export const normalizeChatPromptConfig = (
  chatPromptConfig: BackendModelConfig['chat_prompt_config'],
): NonNullable<BackendModelConfig['chat_prompt_config']> =>
  chatPromptConfig?.prompt?.length ? chatPromptConfig : clone(DEFAULT_CHAT_PROMPT_CONFIG)

export const normalizeCompletionPromptConfig = (
  completionPromptConfig: BackendModelConfig['completion_prompt_config'],
): NonNullable<BackendModelConfig['completion_prompt_config']> =>
  completionPromptConfig?.prompt && completionPromptConfig.conversation_histories_role
    ? completionPromptConfig
    : clone(DEFAULT_COMPLETION_PROMPT_CONFIG)
