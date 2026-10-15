import type { StateCreator } from 'zustand'
import type { VersionHistory } from '@/types/workflow'

export type VersionSliceShape = {
  draftSyncError: unknown
  setDraftSyncError: (error: unknown) => void
  draftUpdatedAt: number
  setDraftUpdatedAt: (draftUpdatedAt: number) => void
  publishedAt: number
  setPublishedAt: (publishedAt: number) => void
  currentVersion: VersionHistory | null
  setCurrentVersion: (currentVersion: VersionHistory) => void
  isRestoring: boolean
  setIsRestoring: (isRestoring: boolean) => void
}

export const createVersionSlice: StateCreator<VersionSliceShape> = (set) => ({
  draftSyncError: undefined,
  setDraftSyncError: (draftSyncError) => set({ draftSyncError }),
  draftUpdatedAt: 0,
  setDraftUpdatedAt: (draftUpdatedAt) =>
    set(() => ({
      draftUpdatedAt: draftUpdatedAt ? draftUpdatedAt * 1000 : 0,
      draftSyncError: undefined,
    })),
  publishedAt: 0,
  setPublishedAt: (publishedAt) =>
    set(() => ({ publishedAt: publishedAt ? publishedAt * 1000 : 0 })),
  currentVersion: null,
  setCurrentVersion: (currentVersion) => set(() => ({ currentVersion })),
  isRestoring: false,
  setIsRestoring: (isRestoring) => set(() => ({ isRestoring })),
})
