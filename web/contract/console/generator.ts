import type { StructuredOutput } from '@/app/components/workflow/nodes/llm/types'
import type { BlockEnum, ValueSelector, VarType } from '@/app/components/workflow/types'
import type { CompletionParams } from '@/types/app'
import { type } from '@orpc/contract'
import { base } from '../base'

export type ContextGenerateMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string
}

export type ContextGenerateAvailableVar = {
  value_selector: ValueSelector
  type: VarType
  description?: string
  node_id?: string
  node_title?: string
  node_type?: BlockEnum
  schema?: StructuredOutput['schema'] | Record<string, unknown> | null
}

export type ContextGenerateParameterInfo = {
  name: string
  type?: string
  description?: string
  required?: boolean
  options?: string[]
  min?: number
  max?: number
  default?: string | number | boolean | null
  multiple?: boolean
  label?: string
}

export type ContextGenerateVariable = {
  variable: string
  value_selector: string[]
}

export type ContextGenerateCodeContext = {
  code: string
  outputs?: Record<string, { type: string }>
  variables?: ContextGenerateVariable[]
}

export type ContextGenerateRequest = {
  language?: 'python3' | 'javascript'
  prompt_messages: ContextGenerateMessage[]
  model_config: {
    provider: string
    name: string
    completion_params?: CompletionParams
  }
  available_vars: ContextGenerateAvailableVar[]
  parameter_info: ContextGenerateParameterInfo
  code_context?: ContextGenerateCodeContext | null
}

export type ContextGenerateResponse = {
  variables: ContextGenerateVariable[]
  code_language: string
  code: string
  outputs: Record<string, { type: string }>
  message: string
  error: string
}

export type ContextGenerateSuggestedQuestionsRequest = {
  language: string
  model_config?: {
    provider: string
    name: string
    completion_params?: CompletionParams
  }
  available_vars: ContextGenerateAvailableVar[]
  parameter_info: ContextGenerateParameterInfo
}

export type ContextGenerateSuggestedQuestionsResponse = {
  questions: string[]
  error: string
}

export const contextGenerateContract = base
  .route({
    path: '/context-generate',
    method: 'POST',
  })
  .input(type<{
    body: ContextGenerateRequest
  }>())
  .output(type<ContextGenerateResponse>())

export const contextGenerateSuggestedQuestionsContract = base
  .route({
    path: '/context-generate/suggested-questions',
    method: 'POST',
  })
  .input(type<{
    body: ContextGenerateSuggestedQuestionsRequest
  }>())
  .output(type<ContextGenerateSuggestedQuestionsResponse>())
