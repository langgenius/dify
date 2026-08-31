import type { SessionView } from './contract/types'
import type { ProgressEntry } from './types'
import { atom } from 'jotai'

export const difyBuilderSessionViewAtom = atom<SessionView | null>(null)
export const difyBuilderSessionBusyAtom = atom(false)
export const difyBuilderSessionLastRawAtom = atom<unknown>(null)
export const difyBuilderSessionLastErrorAtom = atom('')
export const difyBuilderSessionProgressLogAtom = atom<ProgressEntry[]>([])

export const difyBuilderSessionScopedAtoms = [
  difyBuilderSessionViewAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastRawAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionProgressLogAtom,
] as const
