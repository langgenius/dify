import type { PreviewActions, PreviewState } from '../types'
import type { NotionPage } from '@/models/common'
import type { CrawlResultItem } from '@/models/datasets'
import { useCallback, useState } from 'react'

/**
 * Custom hook for managing preview state of different data sources
 * Handles file, Notion page, and website preview states
 */
export function usePreview(): PreviewState & PreviewActions {
  const [currentFile, setCurrentFile] = useState<File | undefined>()
  const [currentNotionPage, setCurrentNotionPage] = useState<NotionPage | undefined>()
  const [currentWebsite, setCurrentWebsite] = useState<CrawlResultItem | undefined>()

  const updateCurrentFile = useCallback((file: File) => {
    setCurrentFile(file)
  }, [])

  const hideFilePreview = useCallback(() => {
    setCurrentFile(undefined)
  }, [])

  const updateCurrentPage = useCallback((page: NotionPage) => {
    setCurrentNotionPage(page)
  }, [])

  const hideNotionPagePreview = useCallback(() => {
    setCurrentNotionPage(undefined)
  }, [])

  const updateWebsite = useCallback((website: CrawlResultItem) => {
    setCurrentWebsite(website)
  }, [])

  const hideWebsitePreview = useCallback(() => {
    setCurrentWebsite(undefined)
  }, [])

  return {
    // State
    currentFile,
    currentNotionPage,
    currentWebsite,
    // Actions
    updateCurrentFile,
    hideFilePreview,
    updateCurrentPage,
    hideNotionPagePreview,
    updateWebsite,
    hideWebsitePreview,
  }
}
