import type {
  WorkflowGeneratePayload,
  WorkflowGeneratePlanEventResponse,
  WorkflowGenerateResponse,
  WorkflowInstructionSuggestionsPayload,
} from '@dify/contracts/api/console/workflow-generate/types.gen'
// The generated client handles JSON endpoints. Streaming remains on the
// generator-specific SSE adapter until oRPC supports this event framing.
// eslint-disable-next-line no-restricted-imports
import { sseGeneratorPost } from './base'
import { consoleClient } from './client'

export type GenerateWorkflowBody = WorkflowGeneratePayload
export type GenerateWorkflowResponse = WorkflowGenerateResponse
export type WorkflowGenPlan = WorkflowGeneratePlanEventResponse
export type WorkflowInstructionSuggestionsBody = WorkflowInstructionSuggestionsPayload

export type GenerateWorkflowOptions = {
  getAbortController?: (controller: AbortController) => void
}

export function generateWorkflow(body: GenerateWorkflowBody, options?: GenerateWorkflowOptions) {
  const controller = new AbortController()
  options?.getAbortController?.(controller)
  return consoleClient.workflowGenerate.post({ body }, { signal: controller.signal })
}

export type GenerateWorkflowStreamCallbacks = {
  onPlan?: (plan: WorkflowGenPlan) => void
  onResult?: (result: GenerateWorkflowResponse) => void
  onError?: (message: string) => void
  onCompleted?: () => void
  getAbortController?: (controller: AbortController) => void
}

export function generateWorkflowStream(
  body: GenerateWorkflowBody,
  callbacks: GenerateWorkflowStreamCallbacks,
) {
  return sseGeneratorPost('/workflow-generate/stream', body, {
    onPlan: (data) => callbacks.onPlan?.(data as WorkflowGenPlan),
    onResult: (data) => callbacks.onResult?.(data as GenerateWorkflowResponse),
    onError: callbacks.onError,
    onCompleted: callbacks.onCompleted,
    getAbortController: callbacks.getAbortController,
  })
}

export function fetchWorkflowInstructionSuggestions(
  body: WorkflowInstructionSuggestionsBody,
  options?: GenerateWorkflowOptions,
) {
  const controller = new AbortController()
  options?.getAbortController?.(controller)
  return consoleClient.workflowGenerate.suggestions.post({ body }, { signal: controller.signal })
}
