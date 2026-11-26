import type {
  WorkflowGeneratePayload,
  WorkflowGeneratePlanEventResponse,
  WorkflowGenerateResponse,
  WorkflowInstructionSuggestionsPayload,
} from '@dify/contracts/api/console/workflow-generate/types.gen'
import { consoleClient } from '@/service/console'
import { streamGeneratorEvents } from './event-stream'

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
  return streamGeneratorEvents<WorkflowGeneratePlanEventResponse, WorkflowGenerateResponse>(
    (options) => consoleClient.workflowGenerate.stream.post({ body }, options),
    callbacks,
  )
}

export function fetchWorkflowInstructionSuggestions(
  body: WorkflowInstructionSuggestionsPayload,
  options?: GenerateWorkflowOptions,
) {
  const controller = new AbortController()
  options?.getAbortController?.(controller)
  return consoleClient.workflowGenerate.suggestions.post({ body }, { signal: controller.signal })
}
