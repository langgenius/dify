import type {
  FileUpload,
  RetrieverResource,
  SensitiveWordAvoidance,
  SpeechToText,
  SuggestedQuestionsAfterAnswer,
  TextToSpeech,
} from '@/app/components/base/features/types'
import type { ConversationVariable, EnvironmentVariable } from '@/app/components/workflow/types'
import type { CommonResponse } from '@/models/common'
import { type } from '@orpc/contract'
import { base } from '../base'

export type WorkflowDraftFeaturesPayload = {
  opening_statement: string
  suggested_questions: string[]
  suggested_questions_after_answer?: SuggestedQuestionsAfterAnswer
  text_to_speech?: TextToSpeech
  speech_to_text?: SpeechToText
  retriever_resource?: RetrieverResource
  sensitive_word_avoidance?: SensitiveWordAvoidance
  file_upload?: FileUpload
}

export const workflowDraftEnvironmentVariablesContract = base
  .route({
    path: '/apps/{appId}/workflows/draft/environment-variables',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<{ items: EnvironmentVariable[] }>())

export const workflowDraftUpdateEnvironmentVariablesContract = base
  .route({
    path: '/apps/{appId}/workflows/draft/environment-variables',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
    }
    body: {
      environment_variables: EnvironmentVariable[]
    }
  }>())
  .output(type<CommonResponse>())

export const workflowDraftUpdateConversationVariablesContract = base
  .route({
    path: '/apps/{appId}/workflows/draft/conversation-variables',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
    }
    body: {
      conversation_variables: ConversationVariable[]
    }
  }>())
  .output(type<CommonResponse>())

export const workflowDraftUpdateFeaturesContract = base
  .route({
    path: '/apps/{appId}/workflows/draft/features',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
    }
    body: {
      features: WorkflowDraftFeaturesPayload
    }
  }>())
  .output(type<CommonResponse>())
