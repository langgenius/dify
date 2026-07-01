import type { Viewport } from 'reactflow'
import type { IOnCompleted, IOnData, IOnError, IOnMessageReplace } from './base'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { ChatPromptConfig, CompletionPromptConfig } from '@/models/debug'
import type { AppModeEnum, ModelModeType } from '@/types/app'
import { get, post, sseGeneratorPost, ssePost } from './base'

type BasicAppFirstRes = {
  prompt: string
  variables: string[]
  opening_statement: string
  error?: string
}

export type GenRes = {
  modified: string
  message?: string // tip for human
  variables?: string[] // only for basic app first time rule
  opening_statement?: string // only for basic app first time rule
  error?: string
}

export const stopChatMessageResponding = async (appId: string, taskId: string) => {
  return post(`apps/${appId}/chat-messages/${taskId}/stop`)
}

export const sendCompletionMessage = async (appId: string, body: Record<string, any>, { onData, onCompleted, onError, onMessageReplace }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
  onMessageReplace: IOnMessageReplace
}) => {
  return ssePost(`apps/${appId}/completion-messages`, {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, onError, onMessageReplace })
}

export const fetchSuggestedQuestions = (appId: string, messageId: string, getAbortController?: any) => {
  return get(
    `apps/${appId}/chat-messages/${messageId}/suggested-questions`,
    {},
    {
      getAbortController,
    },
  )
}

export const fetchConversationMessages = (appId: string, conversation_id: string, getAbortController?: any) => {
  return get(`apps/${appId}/chat-messages`, {
    params: {
      conversation_id,
    },
  }, {
    getAbortController,
  })
}

export const generateBasicAppFirstTimeRule = (body: Record<string, any>) => {
  return post<BasicAppFirstRes>('/rule-generate', {
    body,
  })
}

export const generateRule = (body: Record<string, any>) => {
  return post<GenRes>('/instruction-generate', {
    body,
  })
}

/**
 * One structured error from the workflow generator backend. ``code`` is a
 * stable machine-readable identifier the frontend maps to localised copy
 * via the ``workflowGenerator.errors.<code>`` i18n keys; ``detail`` is the
 * raw English diagnostic; ``node_id`` is set when the error is tied to a
 * specific node (the preview canvas can highlight it).
 *
 * Stable codes — adding a new one without updating the i18n map will fall
 * back to ``detail`` and that's fine, but every value listed here MUST
 * exist in both en-US and zh-Hans.
 */
// Not exported: knip flags unused exports and the modal looks codes up by
// string interpolation (``workflowGenerator.errors.${code}``) rather than
// importing the union. Kept here so the ``GenerateWorkflowResponse``
// definition below documents the contract in one place.
type GenerateWorkflowErrorCode
  = | 'INVALID_JSON'
    | 'INVALID_SCHEMA'
    | 'EMPTY_INSTRUCTION'
    | 'EMPTY_PLAN'
    | 'UNKNOWN_NODE_REFERENCE'
    | 'INVALID_CONTAINER'
    | 'UNRESOLVED_REFERENCE'
    | 'UNKNOWN_TOOL'
    | 'MISSING_TERMINAL'
    | 'MISSING_START'
    | 'DANGLING_EDGE'
    | 'MODEL_ERROR'

type GenerateWorkflowError = {
  code: GenerateWorkflowErrorCode | string
  detail: string
  node_id?: string
}

export type GenerateWorkflowResponse = {
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
  message?: string
  /**
   * Planner-picked product-style name (e.g. "URL Summarizer"). Empty when
   * the planner omits it; the caller (applyToNewApp) supplies a fallback.
   */
  app_name?: string
  /**
   * Planner-picked emoji that captures the workflow's purpose. Empty when
   * the planner omits it; the caller supplies a 🤖 fallback.
   */
  icon?: string
  /**
   * Resolved app mode. Echoes the request mode, except when the request used
   * ``mode: 'auto'`` — then this is the concrete mode the planner picked, which
   * the caller uses to decide which app type to create.
   */
  mode?: 'workflow' | 'advanced-chat'
  /** Human-readable concatenation of ``errors[].detail``. "" on success. */
  error?: string
  /** Structured errors with stable codes for FE-localised mapping. [] on success. */
  errors?: GenerateWorkflowError[]
}

export type GenerateWorkflowBody = {
  /** ``'auto'`` lets the planner pick Workflow vs Chatflow; the resolved mode comes back on the response. */
  mode: 'workflow' | 'advanced-chat' | 'auto'
  instruction: string
  ideal_output?: string
  model_config: { provider: string, name: string, mode: string, completion_params?: Record<string, unknown> }
  /**
   * Existing draft graph for the cmd+k `/refine` flow. When present the
   * backend refines this graph instead of generating from scratch. Omitted
   * for `/create`.
   */
  current_graph?: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
}

export type GenerateWorkflowOptions = {
  /**
   * Callback receiving the ``AbortController`` for the in-flight request.
   * The caller stores it and aborts on modal close / second submit / hard
   * timeout. Pattern mirrors ``fetchSuggestedQuestions`` / ``fetchConversationMessages``
   * which already thread this through ``base.ts``.
   */
  getAbortController?: (controller: AbortController) => void
}

export const generateWorkflow = (body: GenerateWorkflowBody, options?: GenerateWorkflowOptions) => {
  // Only pass the third argument when the caller actually supplied one —
  // otherwise the shared ``post()`` wrapper sees ``undefined`` and that
  // breaks tests asserting the 2-arg call shape, with no behaviour upside.
  if (options?.getAbortController) {
    return post<GenerateWorkflowResponse>('/workflow-generate', { body }, {
      getAbortController: options.getAbortController,
    })
  }
  return post<GenerateWorkflowResponse>('/workflow-generate', { body })
}

// ─── Plan-first streaming (cmd+k generator) ──────────────────────────────────

/** One node in the planner's high-level plan, shown before the graph builds. */
type WorkflowGenPlanNode = {
  label: string
  node_type: string
  purpose?: string
}

/** A start-node input the generated app will ask the end-user for. */
type WorkflowGenPlanInput = {
  variable: string
  label?: string
  type?: string
}

/** The planner result, streamed ahead of the built graph as the ``plan`` event. */
export type WorkflowGenPlan = {
  title?: string
  description?: string
  app_name?: string
  icon?: string
  /** Resolved mode — concrete even when the request used ``mode: 'auto'``. */
  mode?: 'workflow' | 'advanced-chat'
  nodes: WorkflowGenPlanNode[]
  start_inputs?: WorkflowGenPlanInput[]
}

export type GenerateWorkflowStreamCallbacks = {
  onPlan?: (plan: WorkflowGenPlan) => void
  onResult?: (result: GenerateWorkflowResponse) => void
  onError?: (message: string) => void
  onCompleted?: () => void
  getAbortController?: (controller: AbortController) => void
}

/**
 * Plan-first streaming variant of ``generateWorkflow``. The backend emits the
 * planner result (``onPlan``) as soon as it's ready — typically a few seconds
 * in — then the built graph (``onResult``) once the builder + validation
 * finish. Lets the modal show real progress (an outline of the plan) instead
 * of a guessed phase timer, and surfaces the graph the moment it lands.
 */
export const generateWorkflowStream = (
  body: GenerateWorkflowBody,
  callbacks: GenerateWorkflowStreamCallbacks,
) => {
  return sseGeneratorPost('/workflow-generate/stream', body, {
    onPlan: data => callbacks.onPlan?.(data as unknown as WorkflowGenPlan),
    onResult: data => callbacks.onResult?.(data as unknown as GenerateWorkflowResponse),
    onError: callbacks.onError,
    onCompleted: callbacks.onCompleted,
    getAbortController: callbacks.getAbortController,
  })
}

// ─── AI-generated instruction suggestions (generator "ideas" chips) ───────────

export type WorkflowInstructionSuggestionsBody = {
  mode: 'workflow' | 'advanced-chat'
  /** UI language so suggestions come back localized, e.g. 'zh-Hans'. */
  language?: string
  count?: number
}

export type WorkflowInstructionSuggestionsResponse = {
  suggestions: string[]
}

/**
 * Fetch a handful of short, workspace-grounded example instructions for the
 * generator's "ideas" chips. Backed by the tenant default model; the backend
 * soft-fails to ``{ suggestions: [] }`` (no toast), so the caller falls back to
 * its static curated list on an empty result.
 */
export const fetchWorkflowInstructionSuggestions = (
  body: WorkflowInstructionSuggestionsBody,
  options?: GenerateWorkflowOptions,
) => {
  if (options?.getAbortController) {
    return post<WorkflowInstructionSuggestionsResponse>('/workflow-generate/suggestions', { body }, {
      getAbortController: options.getAbortController,
    })
  }
  return post<WorkflowInstructionSuggestionsResponse>('/workflow-generate/suggestions', { body })
}

export const fetchPromptTemplate = ({
  appMode,
  mode,
  modelName,
  hasSetDataSet,
}: { appMode: AppModeEnum, mode: ModelModeType, modelName: string, hasSetDataSet: boolean }) => {
  return get<Promise<{ chat_prompt_config: ChatPromptConfig, completion_prompt_config: CompletionPromptConfig, stop: [] }>>('/app/prompt-templates', {
    params: {
      app_mode: appMode,
      model_mode: mode,
      model_name: modelName,
      has_context: hasSetDataSet,
    },
  })
}

export const fetchTextGenerationMessage = ({
  appId,
  messageId,
}: { appId: string, messageId: string }) => {
  return get<Promise<any>>(`/apps/${appId}/messages/${messageId}`)
}
