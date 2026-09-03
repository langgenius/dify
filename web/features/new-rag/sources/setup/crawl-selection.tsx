'use client'

import type { CrawlPreviewPage as PreviewPage } from '../source-models'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { crawlPreviewPageSkipReason, MAX_SELECTED_PAGES } from './crawl-selection-model'

export function CrawlPreviewPageSelection({
  busy = false,
  disabled = false,
  onRecrawl,
  onSelectionChange,
  pages,
  progressFailed = 0,
  recrawlDisabled,
  rootUrl,
  sourceLabel,
  selectedPageIds,
}: {
  busy?: boolean
  disabled?: boolean
  onRecrawl?: () => void
  onSelectionChange: (pageIds: Set<string>) => void
  pages: PreviewPage[]
  progressFailed?: number
  recrawlDisabled?: boolean
  rootUrl?: string
  sourceLabel?: string
  selectedPageIds: Set<string>
}) {
  const { t } = useTranslation('knowledgeSpace')
  const pageDescriptionPrefixId = useId()
  const pageSkipReasons = useMemo(
    () => new Map(pages.map((page) => [page.pageId, crawlPreviewPageSkipReason(page, rootUrl)])),
    [pages, rootUrl],
  )
  const selectablePages = useMemo(
    () => pages.filter((page) => !pageSkipReasons.get(page.pageId)),
    [pageSkipReasons, pages],
  )
  const selectablePageIds = useMemo(
    () => new Set(selectablePages.map((page) => page.pageId)),
    [selectablePages],
  )
  const bulkSelectablePages = selectablePages.slice(0, MAX_SELECTED_PAGES)
  const allSelected =
    bulkSelectablePages.length > 0 &&
    bulkSelectablePages.every((page) => selectedPageIds.has(page.pageId))
  const someSelected = selectedPageIds.size > 0
  const selectionAtLimit = selectedPageIds.size >= MAX_SELECTED_PAGES
  const selectionLocked = disabled || busy

  const togglePage = (pageId: string) => {
    if (!selectablePageIds.has(pageId) || selectionLocked) return
    onSelectionChange(
      new Set(
        selectedPageIds.has(pageId)
          ? [...selectedPageIds].filter((selectedPageId) => selectedPageId !== pageId)
          : selectedPageIds.size < MAX_SELECTED_PAGES
            ? [...selectedPageIds, pageId]
            : selectedPageIds,
      ),
    )
  }

  const toggleAll = () => {
    if (selectionLocked) return
    onSelectionChange(
      allSelected ? new Set() : new Set(bulkSelectablePages.map((page) => page.pageId)),
    )
  }

  return (
    <section aria-labelledby="crawl-selection-summary">
      <div className="flex flex-wrap items-center gap-3.5">
        <h3
          id="crawl-selection-summary"
          role="status"
          aria-live="polite"
          className="min-w-0 flex-1 truncate system-xs-semibold text-text-primary"
        >
          {t(($) => $.pagesCrawled, {
            count: pages.length,
            host: sourceLabel ?? (rootUrl ? new URL(rootUrl).host : ''),
          })}
        </h3>
        <span className="system-xs-regular text-text-tertiary">
          {t(($) => $.pagesSelected, { count: selectedPageIds.size })}
        </span>
        {progressFailed > 0 && (
          <span className="system-xs-regular text-text-destructive">
            {progressFailed} {t(($) => $.skippedFailed)}
          </span>
        )}
        {onRecrawl && (
          <Button
            type="button"
            variant="ghost-accent"
            size="small"
            disabled={recrawlDisabled ?? selectionLocked}
            loading={busy}
            className="px-0"
            onClick={onRecrawl}
          >
            {t(($) => $.reCrawl)}
          </Button>
        )}
      </div>
      <div className="mt-3 flex h-79 flex-col overflow-hidden rounded-xl border border-divider-regular">
        <label className="flex shrink-0 cursor-pointer items-center gap-2.5 border-b border-divider-subtle bg-background-section px-3 py-2.5 system-xs-medium text-text-secondary">
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            onCheckedChange={toggleAll}
            disabled={!selectablePages.length || selectionLocked}
          />
          {t(($) => $.selectAll)}
        </label>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {pages.map((page, index) => {
            const skipReason = pageSkipReasons.get(page.pageId)
            const selectable = !skipReason
            const selectionLimitReached =
              selectable && selectionAtLimit && !selectedPageIds.has(page.pageId)
            const titleId = `${pageDescriptionPrefixId}-title-${index}`
            const urlId = `${pageDescriptionPrefixId}-url-${index}`
            const reasonId = `${pageDescriptionPrefixId}-reason-${index}`
            return (
              <li key={page.pageId}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
                  <Checkbox
                    checked={selectedPageIds.has(page.pageId)}
                    disabled={!selectable || selectionLimitReached || selectionLocked}
                    aria-labelledby={titleId}
                    aria-describedby={`${urlId}${skipReason || selectionLimitReached ? ` ${reasonId}` : ''}`}
                    onCheckedChange={() => togglePage(page.pageId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      id={titleId}
                      className="block truncate system-xs-medium text-text-primary"
                    >
                      {page.title || page.sourceUrl}
                    </span>
                    <span
                      id={urlId}
                      className="block truncate system-2xs-regular text-text-tertiary"
                    >
                      {page.sourceUrl.replace(/^https?:\/\//, '')}
                    </span>
                  </span>
                  {(!selectable || selectionLimitReached) && (
                    <span id={reasonId} className="shrink-0 system-xs-medium text-text-tertiary">
                      {selectionLimitReached
                        ? `${t(($) => $.maxPages)}: ${MAX_SELECTED_PAGES}`
                        : skipReason === 'off-domain'
                          ? t(($) => $.skippedOffDomain)
                          : t(($) => $.skippedFailed)}
                    </span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
