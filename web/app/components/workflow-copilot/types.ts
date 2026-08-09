// Contracts for the enterprise `workflow-copilot` Fix session API. There is no
// generated contract for this endpoint yet (enterprise-only, still under active
// design), so these mirror the backend's JSON responses by hand until one exists.

export type SessionView = {
  SessionID: string
  AppID: string
  Version: number
  State: string
  CanvasReadOnly: boolean
  RunStatus: string
  Interrupted: boolean
  Conversation: {
    Seq: number
    Kind: string
    Payload: Record<string, unknown>
    AtVersion: number
  }[]
}

export type ProgressEntry = {
  id: number
  event: string
  data: unknown
}

export const COPILOT_ACTION_KINDS = [
  'approve_repair',
  'run_verify',
  'provide_testdata',
  'publish',
  'undo',
  're_fix',
] as const

export type CopilotActionKind = (typeof COPILOT_ACTION_KINDS)[number]

export function isSessionView(value: unknown): value is SessionView {
  if (typeof value !== 'object' || value === null) return false
  return 'SessionID' in value && 'Version' in value
}

// Parses one `event: <kind>\ndata: <json>` SSE frame (already split on the `\n\n` delimiter).
export function parseSSEFrame(frame: string): { event: string; data: unknown } | null {
  const lines = frame.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  lines.forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  })
  if (dataLines.length === 0) return null
  const raw = dataLines.join('\n')
  let data: unknown = raw
  try {
    data = JSON.parse(raw)
  } catch {
    // not JSON, keep the raw string
  }
  return { event, data }
}
