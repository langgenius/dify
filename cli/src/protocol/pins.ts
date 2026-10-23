// Input properties the CLI fills from the local session when the caller leaves them out.
export const PIN = {
  Workspace: 'workspace_id',
} as const

export type Pin = (typeof PIN)[keyof typeof PIN]
