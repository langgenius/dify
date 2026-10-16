import type {
  WorkflowGeneratePayload,
  WorkflowGeneratePlanEventResponse,
  WorkflowGenerateResponse,
  WorkflowInstructionSuggestionsPayload,
} from '@dify/contracts/api/console/workflow-generate/types.gen'
// The generated client handles JSON endpoints. Streaming remains on the
// generator-specific SSE adapter until oRPC supports this event framing.
import { consoleClient } from '@/service/console'
// oxlint-disable-next-line no-restricted-imports
import { sseGeneratorPost } from './base'

export type GenerateWorkflowOptions = {
  getAbortController?: (controller: AbortController) => void
}

export function generateWorkflow(body: WorkflowGeneratePayload, options?: GenerateWorkflowOptions) {
  const controller = new AbortController()
  options?.getAbortController?.(controller)
  return consoleClient.workflowGenerate.post({ body }, { signal: controller.signal })
}

export type GenerateWorkflowStreamCallbacks = {
  onPlan?: (plan: WorkflowGeneratePlanEventResponse) => void
  onResult?: (result: WorkflowGenerateResponse) => void
  onError?: (message: string) => void
  onCompleted?: () => void
  getAbortController?: (controller: AbortController) => void
}

export function generateWorkflowStream(
  body: WorkflowGeneratePayload,
  callbacks: GenerateWorkflowStreamCallbacks,
) {
  return sseGeneratorPost('/workflow-generate/stream', body, {
    onPlan: (data) => callbacks.onPlan?.(data as WorkflowGeneratePlanEventResponse),
    onResult: (data) => callbacks.onResult?.(data as WorkflowGenerateResponse),
    onError: callbacks.onError,
    onCompleted: callbacks.onCompleted,
    getAbortController: callbacks.getAbortController,
  })
}

export function fetchWorkflowInstructionSuggestions(
  body: WorkflowInstructionSuggestionsPayload,
  options?: GenerateWorkflowOptions,
) {
  const controller = new AbortController()
  options?.getAbortController?.(controller)
  return consoleClient.workflowGenerate.suggestions.post({ body }, { signal: controller.signal })
}
