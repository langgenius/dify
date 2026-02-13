import type { WebsiteCrawlSliceShape } from '../website-crawl'
import type { CrawlResult, CrawlResultItem } from '@/models/datasets'
import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand'
import { CrawlStep } from '@/models/datasets'
import { createWebsiteCrawlSlice } from '../website-crawl'

const createTestStore = () => createStore<WebsiteCrawlSliceShape>((...args) => createWebsiteCrawlSlice(...args))

describe('createWebsiteCrawlSlice', () => {
  it('should initialize with default values', () => {
    const state = createTestStore().getState()

    expect(state.websitePages).toEqual([])
    expect(state.currentWebsite).toBeUndefined()
    expect(state.crawlResult).toBeUndefined()
    expect(state.step).toBe(CrawlStep.init)
    expect(state.previewIndex).toBe(-1)
    expect(state.previewWebsitePageRef.current).toBeUndefined()
  })

  it('should set website pages and update preview ref', () => {
    const store = createTestStore()
    const pages = [
      { title: 'Page 1', source_url: 'https://a.com' },
      { title: 'Page 2', source_url: 'https://b.com' },
    ] as unknown as CrawlResultItem[]
    store.getState().setWebsitePages(pages)
    expect(store.getState().websitePages).toEqual(pages)
    expect(store.getState().previewWebsitePageRef.current).toEqual(pages[0])
  })

  it('should set current website', () => {
    const store = createTestStore()
    const website = { title: 'Page 1' } as unknown as CrawlResultItem
    store.getState().setCurrentWebsite(website)
    expect(store.getState().currentWebsite).toEqual(website)
  })

  it('should set crawl result', () => {
    const store = createTestStore()
    const result = { data: { count: 5 } } as unknown as CrawlResult
    store.getState().setCrawlResult(result)
    expect(store.getState().crawlResult).toEqual(result)
  })

  it('should set step', () => {
    const store = createTestStore()
    store.getState().setStep(CrawlStep.running)
    expect(store.getState().step).toBe(CrawlStep.running)
  })

  it('should set preview index', () => {
    const store = createTestStore()
    store.getState().setPreviewIndex(3)
    expect(store.getState().previewIndex).toBe(3)
  })

  it('should clear current website with undefined', () => {
    const store = createTestStore()
    store.getState().setCurrentWebsite({ title: 'X' } as unknown as CrawlResultItem)
    store.getState().setCurrentWebsite(undefined)
    expect(store.getState().currentWebsite).toBeUndefined()
  })
})
