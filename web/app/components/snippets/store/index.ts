'use client'

import type { SnippetInputField, SnippetSection } from '@/models/snippet'
import { create } from 'zustand'

type SnippetDetailUIState = {
  activeSection: SnippetSection
  isInputPanelOpen: boolean
  isPublishMenuOpen: boolean
  isPreviewMode: boolean
  isEditorOpen: boolean
  editingField: SnippetInputField | null
  setActiveSection: (section: SnippetSection) => void
  setInputPanelOpen: (value: boolean) => void
  toggleInputPanel: () => void
  setPublishMenuOpen: (value: boolean) => void
  togglePublishMenu: () => void
  setPreviewMode: (value: boolean) => void
  openEditor: (field?: SnippetInputField | null) => void
  closeEditor: () => void
  reset: () => void
}

const initialState = {
  activeSection: 'orchestrate' as SnippetSection,
  isInputPanelOpen: false,
  isPublishMenuOpen: false,
  isPreviewMode: false,
  editingField: null,
  isEditorOpen: false,
}

export const useSnippetDetailStore = create<SnippetDetailUIState>(set => ({
  ...initialState,
  setActiveSection: activeSection => set({ activeSection }),
  setInputPanelOpen: isInputPanelOpen => set({ isInputPanelOpen }),
  toggleInputPanel: () => set(state => ({ isInputPanelOpen: !state.isInputPanelOpen, isPublishMenuOpen: false })),
  setPublishMenuOpen: isPublishMenuOpen => set({ isPublishMenuOpen }),
  togglePublishMenu: () => set(state => ({ isPublishMenuOpen: !state.isPublishMenuOpen })),
  setPreviewMode: isPreviewMode => set({ isPreviewMode }),
  openEditor: (editingField = null) => set({ editingField, isEditorOpen: true, isInputPanelOpen: true }),
  closeEditor: () => set({ editingField: null, isEditorOpen: false }),
  reset: () => set(initialState),
}))
