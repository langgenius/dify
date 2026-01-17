import type { StateCreator } from 'zustand'

export type MetadataSliceShape = {
  fileMetadata: Map<string, Record<string, any>>
  dirtyMetadataIds: Set<string>
  setFileMetadata: (fileId: string, metadata: Record<string, any>) => void
  setDraftMetadata: (fileId: string, metadata: Record<string, any>) => void
  clearDraftMetadata: (fileId: string) => void
  clearFileMetadata: (fileId: string) => void
  isMetadataDirty: (fileId: string) => boolean
  getFileMetadata: (fileId: string) => Record<string, any> | undefined
}

export const createMetadataSlice: StateCreator<MetadataSliceShape> = (set, get) => ({
  fileMetadata: new Map<string, Record<string, any>>(),
  dirtyMetadataIds: new Set<string>(),

  setFileMetadata: (fileId: string, metadata: Record<string, any>) => {
    const { fileMetadata } = get()
    const nextMap = new Map(fileMetadata)
    if (metadata)
      nextMap.set(fileId, metadata)
    else
      nextMap.delete(fileId)
    set({ fileMetadata: nextMap })
  },

  setDraftMetadata: (fileId: string, metadata: Record<string, any>) => {
    const { fileMetadata, dirtyMetadataIds } = get()
    const nextMap = new Map(fileMetadata)
    nextMap.set(fileId, metadata || {})
    const nextDirty = new Set(dirtyMetadataIds)
    nextDirty.add(fileId)
    set({ fileMetadata: nextMap, dirtyMetadataIds: nextDirty })
  },

  clearDraftMetadata: (fileId: string) => {
    const { dirtyMetadataIds } = get()
    if (!dirtyMetadataIds.has(fileId))
      return
    const nextDirty = new Set(dirtyMetadataIds)
    nextDirty.delete(fileId)
    set({ dirtyMetadataIds: nextDirty })
  },

  clearFileMetadata: (fileId: string) => {
    const { fileMetadata, dirtyMetadataIds } = get()
    const nextMap = new Map(fileMetadata)
    nextMap.delete(fileId)
    const nextDirty = new Set(dirtyMetadataIds)
    nextDirty.delete(fileId)
    set({ fileMetadata: nextMap, dirtyMetadataIds: nextDirty })
  },

  isMetadataDirty: (fileId: string) => {
    return get().dirtyMetadataIds.has(fileId)
  },

  getFileMetadata: (fileId: string) => {
    return get().fileMetadata.get(fileId)
  },
})
