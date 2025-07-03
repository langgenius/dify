import type { StateCreator } from 'zustand'
import type { DataSourceNotionWorkspace, NotionPage } from '@/models/common'

export type OnlineDocumentSliceShape = {
  documentData: DataSourceNotionWorkspace[]
  setDocumentData: (documentData: DataSourceNotionWorkspace[]) => void
  searchValue: string
  setSearchValue: (searchValue: string) => void
  currentWorkspaceId: string
  setCurrentWorkspaceId: (workspaceId: string) => void
  onlineDocuments: NotionPage[]
  setOnlineDocuments: (documents: NotionPage[]) => void
  currentDocument: NotionPage | undefined
  setCurrentDocument: (document: NotionPage | undefined) => void
  selectedPagesId: Set<string>
  setSelectedPagesId: (selectedPagesId: Set<string>) => void
}

export const createOnlineDocumentSlice: StateCreator<OnlineDocumentSliceShape> = (set) => {
  return ({
    documentData: [],
    setDocumentData: (documentData: DataSourceNotionWorkspace[]) => set(() => ({
      documentData,
    })),
    searchValue: '',
    setSearchValue: (searchValue: string) => set(() => ({
      searchValue,
    })),
    currentWorkspaceId: '',
    setCurrentWorkspaceId: (workspaceId: string) => set(() => ({
      currentWorkspaceId: workspaceId,
    })),
    onlineDocuments: [],
    setOnlineDocuments: (documents: NotionPage[]) => set(() => ({
      onlineDocuments: documents,
    })),
    currentDocument: undefined,
    setCurrentDocument: (document: NotionPage | undefined) => set(() => ({
      currentDocument: document,
    })),
    selectedPagesId: new Set(),
    setSelectedPagesId: (selectedPagesId: Set<string>) => set(() => ({
      selectedPagesId,
    })),
  })
}
