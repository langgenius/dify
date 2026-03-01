import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile, DocumentItem, FullDocumentDetail } from '@/models/datasets'
import { useCallback, useState } from 'react'
import { DataSourceType } from '@/models/datasets'

export type UsePreviewStateOptions = {
  dataSourceType: DataSourceType
  files: CustomFile[]
  notionPages: NotionPage[]
  websitePages: CrawlResultItem[]
  documentDetail?: FullDocumentDetail
  datasetId?: string
}

export const usePreviewState = (options: UsePreviewStateOptions) => {
  const {
    dataSourceType,
    files,
    notionPages,
    websitePages,
    documentDetail,
    datasetId,
  } = options

  // File preview state
  const [previewFile, setPreviewFile] = useState<DocumentItem>(
    (datasetId && documentDetail)
      ? documentDetail.file
      : files[0],
  )

  // Notion page preview state
  const [previewNotionPage, setPreviewNotionPage] = useState<NotionPage>(
    (datasetId && documentDetail)
      ? documentDetail.notion_page
      : notionPages[0],
  )

  // Website page preview state
  const [previewWebsitePage, setPreviewWebsitePage] = useState<CrawlResultItem>(
    (datasetId && documentDetail)
      ? documentDetail.website_page
      : websitePages[0],
  )

  // Get preview items for document picker based on data source type
  const getPreviewPickerItems = useCallback(() => {
    if (dataSourceType === DataSourceType.FILE) {
      return files as Array<Required<CustomFile>>
    }
    if (dataSourceType === DataSourceType.NOTION) {
      return notionPages.map(page => ({
        id: page.page_id,
        name: page.page_name,
        extension: 'md',
      }))
    }
    if (dataSourceType === DataSourceType.WEB) {
      return websitePages.map(page => ({
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
      return previewFile as Required<CustomFile>
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
  const handlePreviewChange = useCallback((selected: { id: string, name: string }) => {
    if (dataSourceType === DataSourceType.FILE) {
      setPreviewFile(selected as DocumentItem)
    }
    else if (dataSourceType === DataSourceType.NOTION) {
      const selectedPage = notionPages.find(page => page.page_id === selected.id)
      if (selectedPage)
        setPreviewNotionPage(selectedPage)
    }
    else if (dataSourceType === DataSourceType.WEB) {
      const selectedPage = websitePages.find(page => page.source_url === selected.id)
      if (selectedPage)
        setPreviewWebsitePage(selectedPage)
    }
  }, [dataSourceType, notionPages, websitePages])

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

export type PreviewState = ReturnType<typeof usePreviewState>
