'use client'

import type { InputVar } from '@/models/pipeline'
import { create } from 'zustand'

type SnippetDraftState = {
  snippetId?: string
  inputFields: InputVar[]
  hydrateDraft: (payload: { snippetId: string; inputFields: InputVar[] }) => void
  setInputFields: (inputFields: InputVar[]) => void
  reset: () => void
}

const initialState = {
  snippetId: undefined,
  inputFields: [] as InputVar[],
}

export const useSnippetDraftStore = create<SnippetDraftState>((set) => ({
  ...initialState,
  hydrateDraft: ({ snippetId, inputFields }) => set({ snippetId, inputFields }),
  setInputFields: (inputFields) => set({ inputFields }),
  reset: () => set(initialState),
}))
