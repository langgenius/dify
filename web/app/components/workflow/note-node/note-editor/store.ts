import { useContext } from 'react'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import NoteEditorContext from './context'

type Shape = {
  anchorElement: HTMLElement | null
  setAnchorElement: (anchorElement: HTMLElement | null) => void
  isBold: boolean
  setIsBold: (isBold: boolean) => void
  isStrikeThrough: boolean
  setIsStrikeThrough: (isStrikeThrough: boolean) => void
  isLink: boolean
  setIsLink: (isLink: boolean) => void
}

export const createNoteEditorStore = () => {
  return createStore<Shape>(set => ({
    anchorElement: null,
    setAnchorElement: anchorElement => set(() => ({ anchorElement })),
    isBold: false,
    setIsBold: isBold => set(() => ({ isBold })),
    isStrikeThrough: false,
    setIsStrikeThrough: isStrikeThrough => set(() => ({ isStrikeThrough })),
    isLink: false,
    setIsLink: isLink => set(() => ({ isLink })),
  }))
}

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = useContext(NoteEditorContext)
  if (!store)
    throw new Error('Missing NoteEditorContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useNoteEditorStore = () => {
  return useContext(NoteEditorContext)!
}
