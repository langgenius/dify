import type { DataSourceNotionPageMap, DataSourceNotionWorkspace } from '@/models/common'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CrawlStep } from '@/models/datasets'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../data-source/store'

/**
 * Hook for local file datasource store operations
 */
export const useLocalFile = () => {
  const {
    localFileList,
    currentLocalFile,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    localFileList: state.localFileList,
    currentLocalFile: state.currentLocalFile,
  })))
  const dataSourceStore = useDataSourceStore()

  const allFileLoaded = useMemo(() => (localFileList.length > 0 && localFileList.every(file => file.file.id)), [localFileList])

  const hidePreviewLocalFile = useCallback(() => {
    const { setCurrentLocalFile } = dataSourceStore.getState()
    setCurrentLocalFile(undefined)
  }, [dataSourceStore])

  return {
    localFileList,
    allFileLoaded,
    currentLocalFile,
    hidePreviewLocalFile,
  }
}

/**
 * Hook for online document datasource store operations
 */
export const useOnlineDocument = () => {
  const {
    documentsData,
    onlineDocuments,
    currentDocument,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    documentsData: state.documentsData,
    onlineDocuments: state.onlineDocuments,
    currentDocument: state.currentDocument,
  })))
  const dataSourceStore = useDataSourceStore()

  const currentWorkspace = documentsData[0]

  const PagesMapAndSelectedPagesId: DataSourceNotionPageMap = useMemo(() => {
    const pagesMap = (documentsData || []).reduce((prev: DataSourceNotionPageMap, next: DataSourceNotionWorkspace) => {
      next.pages.forEach((page) => {
        prev[page.page_id] = {
          ...page,
          workspace_id: next.workspace_id,
        }
      })

      return prev
    }, {})
    return pagesMap
  }, [documentsData])

  const hidePreviewOnlineDocument = useCallback(() => {
    const { setCurrentDocument } = dataSourceStore.getState()
    setCurrentDocument(undefined)
  }, [dataSourceStore])

  const clearOnlineDocumentData = useCallback(() => {
    const {
      setDocumentsData,
      setSearchValue,
      setSelectedPagesId,
      setOnlineDocuments,
      setCurrentDocument,
    } = dataSourceStore.getState()
    setDocumentsData([])
    setSearchValue('')
    setSelectedPagesId(new Set())
    setOnlineDocuments([])
    setCurrentDocument(undefined)
  }, [dataSourceStore])

  return {
    currentWorkspace,
    onlineDocuments,
    currentDocument,
    PagesMapAndSelectedPagesId,
    hidePreviewOnlineDocument,
    clearOnlineDocumentData,
  }
}

/**
 * Hook for website crawl datasource store operations
 */
export const useWebsiteCrawl = () => {
  const {
    websitePages,
    currentWebsite,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    websitePages: state.websitePages,
    currentWebsite: state.currentWebsite,
  })))
  const dataSourceStore = useDataSourceStore()

  const hideWebsitePreview = useCallback(() => {
    const { setCurrentWebsite, setPreviewIndex } = dataSourceStore.getState()
    setCurrentWebsite(undefined)
    setPreviewIndex(-1)
  }, [dataSourceStore])

  const clearWebsiteCrawlData = useCallback(() => {
    const {
      setStep,
      setCrawlResult,
      setWebsitePages,
      setPreviewIndex,
      setCurrentWebsite,
    } = dataSourceStore.getState()
    setStep(CrawlStep.init)
    setCrawlResult(undefined)
    setCurrentWebsite(undefined)
    setWebsitePages([])
    setPreviewIndex(-1)
  }, [dataSourceStore])

  return {
    websitePages,
    currentWebsite,
    hideWebsitePreview,
    clearWebsiteCrawlData,
  }
}

/**
 * Hook for online drive datasource store operations
 */
export const useOnlineDrive = () => {
  const {
    onlineDriveFileList,
    selectedFileIds,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    onlineDriveFileList: state.onlineDriveFileList,
    selectedFileIds: state.selectedFileIds,
  })))
  const dataSourceStore = useDataSourceStore()

  const selectedOnlineDriveFileList = useMemo(() => {
    return selectedFileIds.map(id => onlineDriveFileList.find(item => item.id === id)!)
  }, [onlineDriveFileList, selectedFileIds])

  const clearOnlineDriveData = useCallback(() => {
    const {
      setOnlineDriveFileList,
      setBucket,
      setPrefix,
      setKeywords,
      setSelectedFileIds,
    } = dataSourceStore.getState()
    setOnlineDriveFileList([])
    setBucket('')
    setPrefix([])
    setKeywords('')
    setSelectedFileIds([])
  }, [dataSourceStore])

  return {
    onlineDriveFileList,
    selectedFileIds,
    selectedOnlineDriveFileList,
    clearOnlineDriveData,
  }
}
