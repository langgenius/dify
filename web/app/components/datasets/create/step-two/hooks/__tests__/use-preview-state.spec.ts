import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'
import { usePreviewState } from '../use-preview-state'

// Factory functions
const createFile = (id: string, name: string): CustomFile => ({
  id,
  name,
  size: 1024,
  type: 'text/plain',
  extension: 'txt',
  created_by: 'user',
  created_at: Date.now(),
} as unknown as CustomFile)

const createNotionPage = (pageId: string, pageName: string): NotionPage => ({
  page_id: pageId,
  page_name: pageName,
  page_icon: null,
  parent_id: '',
  type: 'page',
  is_bound: true,
} as unknown as NotionPage)

const createWebsitePage = (url: string, title: string): CrawlResultItem => ({
  source_url: url,
  title,
  markdown: '',
  description: '',
} as unknown as CrawlResultItem)

describe('usePreviewState', () => {
  const files = [createFile('f-1', 'file1.txt'), createFile('f-2', 'file2.txt')]
  const notionPages = [createNotionPage('np-1', 'Page 1'), createNotionPage('np-2', 'Page 2')]
  const websitePages = [createWebsitePage('https://a.com', 'Site A'), createWebsitePage('https://b.com', 'Site B')]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state for FILE', () => {
    it('should set first file as preview', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.FILE,
        files,
        notionPages: [],
        websitePages: [],
      }))
      expect(result.current.previewFile).toBe(files[0])
    })
  })

  describe('initial state for NOTION', () => {
    it('should set first notion page as preview', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.NOTION,
        files: [],
        notionPages,
        websitePages: [],
      }))
      expect(result.current.previewNotionPage).toBe(notionPages[0])
    })
  })

  describe('initial state for WEB', () => {
    it('should set first website page as preview', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.WEB,
        files: [],
        notionPages: [],
        websitePages,
      }))
      expect(result.current.previewWebsitePage).toBe(websitePages[0])
    })
  })

  describe('getPreviewPickerItems', () => {
    it('should return files for FILE type', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.FILE,
        files,
        notionPages: [],
        websitePages: [],
      }))
      const items = result.current.getPreviewPickerItems()
      expect(items).toHaveLength(2)
    })

    it('should return mapped notion pages for NOTION type', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.NOTION,
        files: [],
        notionPages,
        websitePages: [],
      }))
      const items = result.current.getPreviewPickerItems()
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ id: 'np-1', name: 'Page 1', extension: 'md' })
    })

    it('should return mapped website pages for WEB type', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.WEB,
        files: [],
        notionPages: [],
        websitePages,
      }))
      const items = result.current.getPreviewPickerItems()
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ id: 'https://a.com', name: 'Site A', extension: 'md' })
    })
  })

  describe('getPreviewPickerValue', () => {
    it('should return current preview file for FILE type', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.FILE,
        files,
        notionPages: [],
        websitePages: [],
      }))
      const value = result.current.getPreviewPickerValue()
      expect(value).toBe(files[0])
    })

    it('should return mapped notion page value for NOTION type', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.NOTION,
        files: [],
        notionPages,
        websitePages: [],
      }))
      const value = result.current.getPreviewPickerValue()
      expect(value).toEqual({ id: 'np-1', name: 'Page 1', extension: 'md' })
    })
  })

  describe('handlePreviewChange', () => {
    it('should change preview file for FILE type', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.FILE,
        files,
        notionPages: [],
        websitePages: [],
      }))

      act(() => {
        result.current.handlePreviewChange({ id: 'f-2', name: 'file2.txt' })
      })
      expect(result.current.previewFile).toEqual({ id: 'f-2', name: 'file2.txt' })
    })

    it('should change preview notion page for NOTION type', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.NOTION,
        files: [],
        notionPages,
        websitePages: [],
      }))

      act(() => {
        result.current.handlePreviewChange({ id: 'np-2', name: 'Page 2' })
      })
      expect(result.current.previewNotionPage).toBe(notionPages[1])
    })

    it('should change preview website page for WEB type', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.WEB,
        files: [],
        notionPages: [],
        websitePages,
      }))

      act(() => {
        result.current.handlePreviewChange({ id: 'https://b.com', name: 'Site B' })
      })
      expect(result.current.previewWebsitePage).toBe(websitePages[1])
    })

    it('should not change if selected page not found (NOTION)', () => {
      const { result } = renderHook(() => usePreviewState({
        dataSourceType: DataSourceType.NOTION,
        files: [],
        notionPages,
        websitePages: [],
      }))

      act(() => {
        result.current.handlePreviewChange({ id: 'non-existent', name: 'x' })
      })
      expect(result.current.previewNotionPage).toBe(notionPages[0])
    })
  })
})
