import type { CrawlPreviewPage } from '../source-models'

export const MAX_SELECTED_PAGES = 200

export type CrawlPreviewPageSkipReason = 'failed' | 'off-domain'

export function crawlPreviewPageSkipReason(
  page: CrawlPreviewPage,
  rootUrl?: string,
): CrawlPreviewPageSkipReason | undefined {
  try {
    const candidate = new URL(page.sourceUrl)
    if (
      !['http:', 'https:'].includes(candidate.protocol) ||
      candidate.username ||
      candidate.password
    )
      return 'failed'
    if (!rootUrl) return undefined
    const root = new URL(rootUrl)
    if (candidate.hostname.toLocaleLowerCase() !== root.hostname.toLocaleLowerCase())
      return 'off-domain'
    return undefined
  } catch {
    return 'failed'
  }
}
