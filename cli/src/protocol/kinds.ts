export const KIND = {
  Object: 'object',
  List: 'list',
  Sse: 'sse',
  Text: 'text',
  File: 'file',
} as const

export type Kind = (typeof KIND)[keyof typeof KIND]

export const KINDS: readonly Kind[] = Object.values(KIND)

export function isKind(k: string): k is Kind {
  return (KINDS as readonly string[]).includes(k)
}
