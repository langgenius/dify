import { NoteTheme } from './types'

export const CUSTOM_NOTE_NODE = 'custom-note'

export const THEME_MAP: Record<string, { outer: string; title: string; bg: string; border: string }> = {
  [NoteTheme.blue]: {
    outer: '#2E90FA',
    title: '#D1E9FF',
    bg: '#EFF8FF',
    border: '#84CAFF',
  },
  [NoteTheme.cyan]: {
    outer: '#06AED4',
    title: '#CFF9FE',
    bg: '#ECFDFF',
    border: '#67E3F9',
  },
  [NoteTheme.green]: {
    outer: '#16B364',
    title: '#D3F8DF',
    bg: '#EDFCF2',
    border: '#73E2A3',
  },
  [NoteTheme.yellow]: {
    outer: '#EAAA08',
    title: '#FEF7C3',
    bg: '#FEFBE8',
    border: '#FDE272',
  },
  [NoteTheme.pink]: {
    outer: '#EE46BC',
    title: '#FCE7F6',
    bg: '#FDF2FA',
    border: '#FAA7E0',
  },
  [NoteTheme.violet]: {
    outer: '#875BF7',
    title: '#ECE9FE',
    bg: '#F5F3FF',
    border: '#C3B5FD',
  },
}
