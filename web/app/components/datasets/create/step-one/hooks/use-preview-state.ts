'use client'

import type { NotionPage } from '@/models/common'
import type { CrawlResultItem } from '@/models/datasets'
import { useCallback, useState } from 'react'

export type PreviewState = {
  currentFile: File | undefined
  currentNotionPage: NotionPage | undefined
  currentWebsite: CrawlResultItem | undefined
}

export type PreviewActions = {
  showFilePreview: (file: File) => void
  hideFilePreview: () => void
  showNotionPagePreview: (page: NotionPage) => void
  hideNotionPagePreview: () => void
  showWebsitePreview: (website: CrawlResultItem) => void
  hideWebsitePreview: () => void
}

export type UsePreviewStateReturn = PreviewState & PreviewActions

/**
 * Custom hook for managing preview state across different data source types.
 * Handles file, notion page, and website preview visibility.
 */
function usePreviewState(): UsePreviewStateReturn {
  const [currentFile, setCurrentFile] = useState<File | undefined>()
  const [currentNotionPage, setCurrentNotionPage] = useState<NotionPage | undefined>()
  const [currentWebsite, setCurrentWebsite] = useState<CrawlResultItem | undefined>()

  const showFilePreview = useCallback((file: File) => {
    setCurrentFile(file)
  }, [])

  const hideFilePreview = useCallback(() => {
    setCurrentFile(undefined)
  }, [])

  const showNotionPagePreview = useCallback((page: NotionPage) => {
    setCurrentNotionPage(page)
  }, [])

  const hideNotionPagePreview = useCallback(() => {
    setCurrentNotionPage(undefined)
  }, [])

  const showWebsitePreview = useCallback((website: CrawlResultItem) => {
    setCurrentWebsite(website)
  }, [])

  const hideWebsitePreview = useCallback(() => {
    setCurrentWebsite(undefined)
  }, [])

  return {
    currentFile,
    currentNotionPage,
    currentWebsite,
    showFilePreview,
    hideFilePreview,
    showNotionPagePreview,
    hideNotionPagePreview,
    showWebsitePreview,
    hideWebsitePreview,
  }
}

export default usePreviewState
