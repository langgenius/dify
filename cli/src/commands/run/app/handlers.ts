import type { TextHandler } from '../../../printers/format-text.js'
import type { ColorScheme } from '../../../sys/io/color.js'

export const RUN_MODES = {
  Chat: 'chat',
  AgentChat: 'agent-chat',
  AdvancedChat: 'advanced-chat',
  Completion: 'completion',
  Workflow: 'workflow',
} as const

export type RunMode = typeof RUN_MODES[keyof typeof RUN_MODES]

export type AppRunObject = {
  mode: () => string
  raw: () => Record<string, unknown>
}

export function newAppRunObject(mode: string, resp: Record<string, unknown>): AppRunObject {
  const filled = resp.mode === undefined || resp.mode === '' ? { ...resp, mode } : resp
  return { mode: () => mode, raw: () => filled }
}

export const chatTextHandler: TextHandler = {
  render(raw): string {
    const resp = raw as Record<string, unknown>
    const out: string[] = []
    const answer = pickString(resp, 'answer')
    if (answer !== undefined)
      out.push(answer)
    out.push('')
    return out.join('\n')
  },
}

export const completionTextHandler: TextHandler = {
  render(raw): string {
    const resp = raw as Record<string, unknown>
    const answer = pickString(resp, 'answer')
    return `${answer ?? ''}\n`
  },
}

export const workflowTextHandler: TextHandler = {
  render(raw): string {
    const resp = raw as Record<string, unknown>
    const data = resp.data
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
    return `${JSON.stringify(resp)}\n`
  },
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
