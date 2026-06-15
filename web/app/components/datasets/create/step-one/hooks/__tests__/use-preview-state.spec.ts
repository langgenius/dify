import type { NotionPage } from '@/models/common'
import type { CrawlResultItem } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import usePreviewState from '../use-preview-state'

describe('usePreviewState', () => {
  it('should initialize with all previews undefined', () => {
    const { result } = renderHook(() => usePreviewState())

    expect(result.current.currentFile).toBeUndefined()
    expect(result.current.currentNotionPage).toBeUndefined()
    expect(result.current.currentWebsite).toBeUndefined()
  })

  it('should show and hide file preview', () => {
    const { result } = renderHook(() => usePreviewState())
    const file = new File(['content'], 'test.pdf')

    act(() => {
      result.current.showFilePreview(file)
    })
    expect(result.current.currentFile).toBe(file)

    act(() => {
      result.current.hideFilePreview()
    })
    expect(result.current.currentFile).toBeUndefined()
  })

  it('should show and hide notion page preview', () => {
    const { result } = renderHook(() => usePreviewState())
    const page = { page_id: 'p1', page_name: 'Test' } as unknown as NotionPage

    act(() => {
      result.current.showNotionPagePreview(page)
    })
    expect(result.current.currentNotionPage).toBe(page)

    act(() => {
      result.current.hideNotionPagePreview()
    })
    expect(result.current.currentNotionPage).toBeUndefined()
  })

  it('should show and hide website preview', () => {
    const { result } = renderHook(() => usePreviewState())
    const website = { title: 'Example', source_url: 'https://example.com' } as unknown as CrawlResultItem

    act(() => {
      result.current.showWebsitePreview(website)
    })
    expect(result.current.currentWebsite).toBe(website)

    act(() => {
      result.current.hideWebsitePreview()
    })
    expect(result.current.currentWebsite).toBeUndefined()
  })
})
