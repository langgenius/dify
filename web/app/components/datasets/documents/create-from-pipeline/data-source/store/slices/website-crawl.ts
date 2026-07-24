import type { StateCreator } from 'zustand'
import type { CrawlResult, CrawlResultItem } from '@/models/datasets'
import { CrawlStep } from '@/models/datasets'

export type WebsiteCrawlSliceShape = {
  websitePages: CrawlResultItem[]
  setWebsitePages: (pages: CrawlResultItem[]) => void
  currentWebsite: CrawlResultItem | undefined
  setCurrentWebsite: (website: CrawlResultItem | undefined) => void
  crawlResult: CrawlResult | undefined
  setCrawlResult: (result: CrawlResult | undefined) => void
  step: CrawlStep
  setStep: (step: CrawlStep) => void
  previewIndex: number
  setPreviewIndex: (index: number) => void
  previewWebsitePageRef: React.RefObject<CrawlResultItem | undefined>
}

export const createWebsiteCrawlSlice: StateCreator<WebsiteCrawlSliceShape> = (set, get) => {
  return ({
    websitePages: [],
    setWebsitePages: (pages: CrawlResultItem[]) => {
      set(() => ({
        websitePages: pages,
      }))
      const { previewWebsitePageRef } = get()
      previewWebsitePageRef.current = pages[0]
    },
    currentWebsite: undefined,
    setCurrentWebsite: (website: CrawlResultItem | undefined) => set(() => ({
      currentWebsite: website,
    })),
    crawlResult: undefined,
    setCrawlResult: (result: CrawlResult | undefined) => set(() => ({
      crawlResult: result,
    })),
    step: CrawlStep.init,
    setStep: (step: CrawlStep) => set(() => ({
      step,
    })),
    previewIndex: -1,
    setPreviewIndex: (index: number) => set(() => ({
      previewIndex: index,
    })),
    previewWebsitePageRef: { current: undefined },
  })
}
