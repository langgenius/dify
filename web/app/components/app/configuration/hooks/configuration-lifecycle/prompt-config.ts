import type {
  AppChatPromptPayload,
  AppCompletionPromptPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ChatPromptConfig, CompletionPromptConfig } from '@/models/debug'
import { clone } from 'es-toolkit/object'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'

export const normalizeChatPromptConfig = (
  chatPromptConfig?: AppChatPromptPayload | null,
): ChatPromptConfig =>
  chatPromptConfig?.prompt?.length
    ? {
        ...chatPromptConfig,
        prompt: chatPromptConfig.prompt.map((prompt) => ({
          ...prompt,
          role: prompt.role ?? undefined,
        })),
      }
    : clone(DEFAULT_CHAT_PROMPT_CONFIG)

export const normalizeCompletionPromptConfig = (
  completionPromptConfig?: AppCompletionPromptPayload | null,
): CompletionPromptConfig =>
  completionPromptConfig?.prompt && completionPromptConfig.conversation_histories_role
    ? {
        ...completionPromptConfig,
        prompt: { ...completionPromptConfig.prompt },
        conversation_histories_role: {
          ...completionPromptConfig.conversation_histories_role,
          user_prefix: completionPromptConfig.conversation_histories_role.user_prefix ?? '',
          assistant_prefix:
            completionPromptConfig.conversation_histories_role.assistant_prefix ?? '',
        },
      }
    : clone(DEFAULT_COMPLETION_PROMPT_CONFIG)
