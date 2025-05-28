import { NoteTheme } from './types'

export const CUSTOM_NOTE_NODE = 'custom-note'

export const THEME_MAP: Record<string, { outer: string; title: string; bg: string; border: string }> = {
  [NoteTheme.blue]: {
    outer: 'border-util-colors-blue-blue-500',
    title: 'bg-util-colors-blue-blue-100',
    bg: 'bg-util-colors-blue-blue-50',
    border: 'border-util-colors-blue-blue-300',
  },
  [NoteTheme.cyan]: {
    outer: 'border-util-colors-cyan-cyan-500',
    title: 'bg-util-colors-cyan-cyan-100',
    bg: 'bg-util-colors-cyan-cyan-50',
    border: 'border-util-colors-cyan-cyan-300',
  },
  [NoteTheme.green]: {
    outer: 'border-util-colors-green-green-500',
    title: 'bg-util-colors-green-green-100',
    bg: 'bg-util-colors-green-green-50',
    border: 'border-util-colors-green-green-300',
  },
  [NoteTheme.yellow]: {
    outer: 'border-util-colors-yellow-yellow-500',
    title: 'bg-util-colors-yellow-yellow-100',
    bg: 'bg-util-colors-yellow-yellow-50',
    border: 'border-util-colors-yellow-yellow-300',
  },
  [NoteTheme.pink]: {
    outer: 'border-util-colors-pink-pink-500',
    title: 'bg-util-colors-pink-pink-100',
    bg: 'bg-util-colors-pink-pink-50',
    border: 'border-util-colors-pink-pink-300',
  },
  [NoteTheme.violet]: {
    outer: 'border-util-colors-violet-violet-500',
    title: 'bg-util-colors-violet-violet-100',
    bg: 'bg-util-colors-violet-violet-100',
    border: 'border-util-colors-violet-violet-300',
  },
}
