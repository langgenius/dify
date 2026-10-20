export const BIND = {
  Path: 'path',
  Query: 'query',
  Body: 'body',
  File: 'file',
} as const

export type Bind = (typeof BIND)[keyof typeof BIND]

const BINDS: readonly Bind[] = Object.values(BIND)

export function isBind(b: string): b is Bind {
  return (BINDS as readonly string[]).includes(b)
}
