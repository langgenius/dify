import type { StateCreator } from 'zustand'
import type {
  VersionHistory,
} from '@/types/workflow'

export type VersionSliceShape = {
  draftUpdatedAt: number
  setDraftUpdatedAt: (draftUpdatedAt: number) => void
  publishedAt: number
  setPublishedAt: (publishedAt: number) => void
  currentVersion: VersionHistory | null
  setCurrentVersion: (currentVersion: VersionHistory) => void
  isRestoring: boolean
  setIsRestoring: (isRestoring: boolean) => void
  // True when the current user may only view the workflow (e.g. the `viewer` role).
  // Forces the whole canvas into read-only mode regardless of run/history state.
  isViewerReadOnly: boolean
  setIsViewerReadOnly: (isViewerReadOnly: boolean) => void
}

export const createVersionSlice: StateCreator<VersionSliceShape> = set => ({
  draftUpdatedAt: 0,
  setDraftUpdatedAt: draftUpdatedAt => set(() => ({ draftUpdatedAt: draftUpdatedAt ? draftUpdatedAt * 1000 : 0 })),
  publishedAt: 0,
  setPublishedAt: publishedAt => set(() => ({ publishedAt: publishedAt ? publishedAt * 1000 : 0 })),
  currentVersion: null,
  setCurrentVersion: currentVersion => set(() => ({ currentVersion })),
  isRestoring: false,
  setIsRestoring: isRestoring => set(() => ({ isRestoring })),
  isViewerReadOnly: false,
  setIsViewerReadOnly: isViewerReadOnly => set(() => ({ isViewerReadOnly })),
})
