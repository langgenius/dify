import { use } from 'react'
import { useStore as useZustandStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import NoteEditorContext from './context'

type Shape = {
  linkAnchorElement: HTMLElement | null
  linkEditorDismissed: boolean
  dismissLinkEditor: () => void
  setLinkAnchorElement: (open?: boolean | HTMLElement | null) => void
  linkOperatorShow: boolean
  setLinkOperatorShow: (linkOperatorShow: boolean) => void
  selectedIsBold: boolean
  setSelectedIsBold: (selectedIsBold: boolean) => void
  selectedIsItalic: boolean
  setSelectedIsItalic: (selectedIsItalic: boolean) => void
  selectedIsStrikeThrough: boolean
  setSelectedIsStrikeThrough: (selectedIsStrikeThrough: boolean) => void
  selectedLinkUrl: string
  setSelectedLinkUrl: (selectedLinkUrl: string) => void
  selectedIsLink: boolean
  setSelectedIsLink: (selectedIsLink: boolean) => void
  selectedIsBullet: boolean
  setSelectedIsBullet: (selectedIsBullet: boolean) => void
}

export const createNoteEditorStore = () => {
  let pendingAnchor: ReturnType<typeof setTimeout> | undefined
  return createStore<Shape>((set) => ({
    linkAnchorElement: null,
    linkEditorDismissed: false,
    dismissLinkEditor: () => {
      clearTimeout(pendingAnchor)
      set({ linkAnchorElement: null, linkOperatorShow: false, linkEditorDismissed: true })
    },
    setLinkAnchorElement: (open) => {
      clearTimeout(pendingAnchor)
      if (open instanceof HTMLElement) {
        set({ linkAnchorElement: open, linkEditorDismissed: false })
        return
      }

      if (open) {
        set({ linkEditorDismissed: false })
        pendingAnchor = setTimeout(() => {
          const nativeSelection = window.getSelection()

          if (nativeSelection?.focusNode) {
            const parent = nativeSelection.focusNode.parentElement
            set(() => ({ linkAnchorElement: parent }))
          }
        })
      } else {
        set({ linkAnchorElement: null, linkEditorDismissed: false })
      }
    },
    linkOperatorShow: false,
    setLinkOperatorShow: (linkOperatorShow) => set(() => ({ linkOperatorShow })),
    selectedIsBold: false,
    setSelectedIsBold: (selectedIsBold) => set(() => ({ selectedIsBold })),
    selectedIsItalic: false,
    setSelectedIsItalic: (selectedIsItalic) => set(() => ({ selectedIsItalic })),
    selectedIsStrikeThrough: false,
    setSelectedIsStrikeThrough: (selectedIsStrikeThrough) =>
      set(() => ({ selectedIsStrikeThrough })),
    selectedLinkUrl: '',
    setSelectedLinkUrl: (selectedLinkUrl) => set(() => ({ selectedLinkUrl })),
    selectedIsLink: false,
    setSelectedIsLink: (selectedIsLink) => set(() => ({ selectedIsLink })),
    selectedIsBullet: false,
    setSelectedIsBullet: (selectedIsBullet) => set(() => ({ selectedIsBullet })),
  }))
}

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = use(NoteEditorContext)
  if (!store) throw new Error('Missing NoteEditorContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useNoteEditorStore = () => {
  return use(NoteEditorContext)!
}
