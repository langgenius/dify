'use client'

import type { SnippetDetail, SnippetInputField } from '@/models/snippet'
import { create } from 'zustand'

type SnippetNavigationState = {
  snippet?: SnippetDetail
  snippetId?: string
  readonly: boolean
  onFieldsChange?: (fields: SnippetInputField[]) => void
}

type SnippetDetailUIState = {
  fields: SnippetInputField[]
  setFields: (fields: SnippetInputField[]) => void
  setNavigationState: (state: SnippetNavigationState) => void
  reset: () => void
} & SnippetNavigationState

const initialState = {
  fields: [] as SnippetInputField[],
  readonly: true,
  snippet: undefined,
  snippetId: undefined,
  onFieldsChange: undefined,
}

export const useSnippetDetailStore = create<SnippetDetailUIState>(set => ({
  ...initialState,
  setFields: fields => set({ fields }),
  setNavigationState: state => set(state),
  reset: () => set(initialState),
}))
