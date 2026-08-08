import type { Edge, Node } from '../../types'
// eslint-disable-next-line no-restricted-imports -- copilot has no generated contract yet; reuse the shared JSON client
import { del, get, post } from '@/service/base'

/**
 * Feature service for the Workflow Copilot multi-turn endpoint.
 *
 * Wraps the shared JSON client so the panel depends on a feature module (repo
 * convention) rather than importing `service/base` directly. Targets the
 * backend `/console/api/workflow-copilot` routes added for persistent,
 * memory-backed generation.
 */

export type CopilotGraph = {
  nodes: Node[]
  edges: Edge[]
  viewport?: { x: number; y: number; zoom: number }
}

export type CopilotGenerateBody = {
  app_id: string
  conversation_id?: string | null
  mode: 'workflow' | 'advanced-chat'
  message: string
  model_config: {
    provider: string
    name: string
    mode: string
    completion_params?: Record<string, unknown>
  }
  current_graph?: CopilotGraph
  // Node ids the user pinned as focus context. The backend resolves them to
  // full node structure from `current_graph` and appends to the generator
  // instruction only — the stored user message stays clean.
  context_node_ids?: string[]
}

export type CopilotGenerateResponse = {
  conversation_id: string
  reply: string
  graph?: CopilotGraph
  error?: string
  errors?: { code: string; detail: string; node_id?: string }[]
}

export type CopilotHistoryMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

export type CopilotMessagesResponse = {
  conversation_id: string
  messages: CopilotHistoryMessage[]
}

export const generateWorkflowCopilot = (
  body: CopilotGenerateBody,
  options?: { signal?: AbortSignal },
) => {
  // Pass the caller's AbortSignal through the request options (a first-class
  // RequestInit field) rather than the `getAbortController` callback: the
  // shared client wires an options-level `signal` straight into fetch, so
  // aborting it actually cancels the in-flight turn (Stop).
  if (options?.signal)
    return post<CopilotGenerateResponse>('/workflow-copilot', { body, signal: options.signal })
  return post<CopilotGenerateResponse>('/workflow-copilot', { body })
}

export const fetchCopilotMessages = (conversationId: string) => {
  return get<CopilotMessagesResponse>(`/workflow-copilot/${conversationId}/messages`)
}

export type CopilotConversation = {
  id: string
  title: string
  updated_at: number
}

export type CopilotConversationsResponse = {
  conversations: CopilotConversation[]
}

export const listCopilotConversations = (appId: string) => {
  return get<CopilotConversationsResponse>('/workflow-copilot/conversations', {
    params: { app_id: appId },
  })
}

export const deleteCopilotConversation = (conversationId: string) => {
  return del(`/workflow-copilot/${conversationId}`)
}
