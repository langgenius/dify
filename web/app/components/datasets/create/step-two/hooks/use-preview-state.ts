import type { DocumentDetailResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { StepTwoFile, StepTwoNotionPage } from '../types'
import type { CrawlResultItem, DocumentItem } from '@/models/datasets'
import { useCallback, useState } from 'react'
import { DataSourceType } from '@/models/datasets'

type UsePreviewStateOptions = {
  dataSourceType: DataSourceType
  files: StepTwoFile[]
  notionPages: StepTwoNotionPage[]
  websitePages: CrawlResultItem[]
  documentDetail?: DocumentDetailResponse
  datasetId?: string
}

export const usePreviewState = (options: UsePreviewStateOptions) => {
  const { dataSourceType, files, notionPages, websitePages, documentDetail, datasetId } = options

  // File preview state
  // Editing an existing document has no preview item until one is picked.
  const isEditing = !!datasetId && !!documentDetail
  const [previewFile, setPreviewFile] = useState<StepTwoFile | DocumentItem | undefined>(
    isEditing ? undefined : files[0],
  )

  // Notion page preview state
  const [previewNotionPage, setPreviewNotionPage] = useState<StepTwoNotionPage | undefined>(
    isEditing ? undefined : notionPages[0],
  )

  // Website page preview state
  const [previewWebsitePage, setPreviewWebsitePage] = useState<CrawlResultItem | undefined>(
    isEditing ? undefined : websitePages[0],
  )

  // Get preview items for document picker based on data source type
  const getPreviewPickerItems = useCallback(() => {
    if (dataSourceType === DataSourceType.FILE) {
      return files.map((file) => ({
        id: file.id ?? '',
        name: file.name,
        extension: file.extension ?? '',
      }))
    }
    if (dataSourceType === DataSourceType.NOTION) {
      return notionPages.map((page) => ({
        id: page.page_id,
        name: page.page_name,
        extension: 'md',
      }))
    }
    if (dataSourceType === DataSourceType.WEB) {
      return websitePages.map((page) => ({
        id: page.source_url,
        name: page.title,
        extension: 'md',
      }))
    }
    return []
  }, [dataSourceType, files, notionPages, websitePages])

  // Get current preview value for picker
  const getPreviewPickerValue = useCallback(() => {
    if (dataSourceType === DataSourceType.FILE) {
      return (
        previewFile && {
          id: previewFile.id ?? '',
          name: previewFile.name,
          extension: previewFile.extension ?? '',
        }
      )
    }
    if (dataSourceType === DataSourceType.NOTION) {
      return {
        id: previewNotionPage?.page_id || '',
        name: previewNotionPage?.page_name || '',
        extension: 'md',
      }
    }
    if (dataSourceType === DataSourceType.WEB) {
      return {
        id: previewWebsitePage?.source_url || '',
        name: previewWebsitePage?.title || '',
        extension: 'md',
      }
    }
    return { id: '', name: '', extension: '' }
  }, [dataSourceType, previewFile, previewNotionPage, previewWebsitePage])

  // Handle preview change
  const handlePreviewChange = useCallback(
    (selected: { id: string; name: string }) => {
      if (dataSourceType === DataSourceType.FILE) {
        setPreviewFile(selected as DocumentItem)
      } else if (dataSourceType === DataSourceType.NOTION) {
        const selectedPage = notionPages.find((page) => page.page_id === selected.id)
        if (selectedPage) setPreviewNotionPage(selectedPage)
      } else if (dataSourceType === DataSourceType.WEB) {
        const selectedPage = websitePages.find((page) => page.source_url === selected.id)
        if (selectedPage) setPreviewWebsitePage(selectedPage)
      }
    },
    [dataSourceType, notionPages, websitePages],
  )

  return {
    // File preview
    previewFile,
    setPreviewFile,

    // Notion preview
    previewNotionPage,
    setPreviewNotionPage,

    // Website preview
    previewWebsitePage,
    setPreviewWebsitePage,

    // Picker helpers
    getPreviewPickerItems,
    getPreviewPickerValue,
    handlePreviewChange,
  }
}
