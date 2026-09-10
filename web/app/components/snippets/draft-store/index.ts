'use client'

import type { SnippetInputField } from '@/models/snippet'
import { create } from 'zustand'

type SnippetDraftState = {
  snippetId?: string
  inputFields: SnippetInputField[]
  hydrateDraft: (payload: { snippetId: string; inputFields: SnippetInputField[] }) => void
  setInputFields: (inputFields: SnippetInputField[]) => void
  reset: () => void
}

const initialState = {
  snippetId: undefined,
  inputFields: [] as SnippetInputField[],
}

export const useSnippetDraftStore = create<SnippetDraftState>((set) => ({
  ...initialState,
  hydrateDraft: ({ snippetId, inputFields }) => set({ snippetId, inputFields }),
  setInputFields: (inputFields) => set({ inputFields }),
  reset: () => set(initialState),
}))
