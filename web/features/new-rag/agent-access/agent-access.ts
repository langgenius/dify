import { ORPCError } from '@orpc/client'

/** Lifetimes offered for a personal token; `null` never expires, `custom` asks for a number of days. */
export const PERSONAL_TOKEN_EXPIRY_OPTIONS = [30, 1, 7, null, 'custom'] as const
export const DEFAULT_PERSONAL_TOKEN_EXPIRY_DAYS = 30
export const MAX_PERSONAL_TOKEN_EXPIRY_DAYS = 365

export function agentAccessErrorCode(error: unknown): string | undefined {
  return error instanceof ORPCError && typeof error.code === 'string' ? error.code : undefined
}

/** Knowledge bases the server refused for a connection (`details.knowledge_base_ids`). */
export function rejectedKnowledgeBaseIds(error: unknown): string[] {
  if (!(error instanceof ORPCError)) return []
  const data: unknown = error.data
  const details =
    typeof data === 'object' && data !== null && 'details' in data ? data.details : undefined
  const ids =
    typeof details === 'object' && details !== null && 'knowledge_base_ids' in details
      ? details.knowledge_base_ids
      : undefined
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

/** Native agents listen on a random loopback port, which means nothing to the person approving. */
export function isLoopbackHost(host: string): boolean {
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return name === 'localhost' || name === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(name ?? '')
}
