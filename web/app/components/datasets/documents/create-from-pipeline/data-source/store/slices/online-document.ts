import type { StateCreator } from 'zustand'
import type { DataSourceNotionWorkspace, NotionPage } from '@/models/common'

export type OnlineDocumentSliceShape = {
  documentsData: DataSourceNotionWorkspace[]
  setDocumentsData: (documentData: DataSourceNotionWorkspace[]) => void
  searchValue: string
  setSearchValue: (searchValue: string) => void
  onlineDocuments: NotionPage[]
  setOnlineDocuments: (documents: NotionPage[]) => void
  currentDocument: NotionPage | undefined
  setCurrentDocument: (document: NotionPage | undefined) => void
  selectedPagesId: Set<string>
  setSelectedPagesId: (selectedPagesId: Set<string>) => void
  previewOnlineDocumentRef: React.RefObject<NotionPage | undefined>
}

export const createOnlineDocumentSlice: StateCreator<OnlineDocumentSliceShape> = (set, get) => {
  return ({
    documentsData: [],
    setDocumentsData: (documentsData: DataSourceNotionWorkspace[]) => set(() => ({
      documentsData,
    })),
    searchValue: '',
    setSearchValue: (searchValue: string) => set(() => ({
      searchValue,
    })),
    onlineDocuments: [],
    setOnlineDocuments: (documents: NotionPage[]) => {
      set(() => ({
        onlineDocuments: documents,
      }))
      const { previewOnlineDocumentRef } = get()
      previewOnlineDocumentRef.current = documents[0]
    },
    currentDocument: undefined,
    setCurrentDocument: (document: NotionPage | undefined) => set(() => ({
      currentDocument: document,
    })),
    selectedPagesId: new Set(),
    setSelectedPagesId: (selectedPagesId: Set<string>) => set(() => ({
      selectedPagesId,
    })),
    previewOnlineDocumentRef: { current: undefined },
  })
}
