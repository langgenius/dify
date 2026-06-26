'use client'

import type { SnippetInputField } from '@/models/snippet'
import { create } from 'zustand'

type SnippetDetailUIState = {
  fields: SnippetInputField[]
  setFields: (fields: SnippetInputField[]) => void
  reset: () => void
}

const initialState = {
  fields: [] as SnippetInputField[],
}

export const useSnippetDetailStore = create<SnippetDetailUIState>(set => ({
  ...initialState,
  setFields: fields => set({ fields }),
  reset: () => set(initialState),
}))
