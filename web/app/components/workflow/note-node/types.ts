import type { CommonNodeType } from '../types'

export const NoteTheme = {
  blue: 'blue',
  cyan: 'cyan',
  green: 'green',
  yellow: 'yellow',
  pink: 'pink',
  violet: 'violet',
} as const
export type NoteTheme = typeof NoteTheme[keyof typeof NoteTheme]

export type NoteNodeType = CommonNodeType & {
  text: string
  theme: NoteTheme
  author: string
  showAuthor: boolean
}
