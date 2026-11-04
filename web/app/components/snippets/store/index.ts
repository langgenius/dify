'use client'

import type { InputVar } from '@/models/pipeline'
import type { SnippetDetail } from '@/models/snippet'
import { create } from 'zustand'

type SnippetNavigationState = {
  snippet?: SnippetDetail
  snippetId?: string
  readonly: boolean
  onFieldsChange?: (fields: InputVar[]) => void
}

type SnippetDetailUIState = {
  setNavigationState: (state: SnippetNavigationState) => void
  reset: () => void
} & SnippetNavigationState

const initialState = {
  readonly: true,
  snippet: undefined,
  snippetId: undefined,
  onFieldsChange: undefined,
}

export const useSnippetDetailStore = create<SnippetDetailUIState>((set) => ({
  ...initialState,
  setNavigationState: (state) => set(state),
  reset: () => set(initialState),
}))
