import type { FormattedPrintable } from '@/framework/output'
import type { ColorScheme } from '@/sys/io/color'

export const RUN_MODES = {
  Chat: 'chat',
  AgentChat: 'agent-chat',
  AdvancedChat: 'advanced-chat',
  Completion: 'completion',
  Workflow: 'workflow',
} as const

export type RunMode = typeof RUN_MODES[keyof typeof RUN_MODES]

export type AppRunObject = FormattedPrintable

export function newAppRunObject(mode: string, resp: Record<string, unknown>): AppRunObject {
  const filled = resp.mode === undefined || resp.mode === '' ? { ...resp, mode } : resp
  return {
    text: () => textForMode(mode, filled),
    json: () => filled,
  }
}

function textForMode(mode: string, raw: Record<string, unknown>): string {
  switch (mode) {
    case RUN_MODES.Chat:
    case RUN_MODES.AgentChat:
    case RUN_MODES.AdvancedChat:
      return renderChat(raw)
    case RUN_MODES.Completion:
      return renderCompletion(raw)
    case RUN_MODES.Workflow:
      return renderWorkflow(raw)
    default:
      return `${JSON.stringify(raw)}\n`
  }
}

function renderChat(raw: Record<string, unknown>): string {
  const out: string[] = []
  const answer = pickString(raw, 'answer')
  if (answer !== undefined)
    out.push(answer)
  out.push('')
  return out.join('\n')
}

function renderCompletion(raw: Record<string, unknown>): string {
  return `${pickString(raw, 'answer') ?? ''}\n`
}

function renderWorkflow(raw: Record<string, unknown>): string {
  const data = raw.data
  if (data !== null && typeof data === 'object' && 'outputs' in data) {
    const { outputs } = data as { outputs: unknown }
    if (outputs !== undefined) {
      if (typeof outputs === 'object' && outputs !== null) {
        const entries = Object.entries(outputs as Record<string, unknown>)
        if (entries.length === 1 && typeof entries[0]![1] === 'string')
          return `${entries[0]![1]}\n`
      }
      return `${JSON.stringify(outputs)}\n`
    }
  }
  return `${JSON.stringify(raw)}\n`
}

export function chatConversationHint(resp: Record<string, unknown>, cs: ColorScheme): string | undefined {
  const cid = pickString(resp, 'conversation_id')
  if (cid === undefined || cid === '')
    return undefined
  return `${cs.magenta('hint:')} continue this conversation with --conversation ${cs.cyan(cid)}\n`
}

function pickString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key]
  return typeof v === 'string' ? v : undefined
}
