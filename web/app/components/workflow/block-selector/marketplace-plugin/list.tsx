'use client'
import type { RefObject } from 'react'
import type { Plugin, PluginCategoryEnum } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import Link from '@/next/link'
import useStickyScroll, { ScrollPosition } from '../use-sticky-scroll'
import Item from './item'

export type ListProps = {
  wrapElemRef: React.RefObject<HTMLElement | null>
  list: Plugin[]
  searchText: string
  tags: string[]
  category?: PluginCategoryEnum
  toolContentClassName?: string
  disableMaxWidth?: boolean
  hideFindMoreFooter?: boolean
  ref?: React.Ref<ListRef>
}

export type ListRef = { handleScroll: () => void }

function List({
  wrapElemRef,
  searchText,
  tags,
  list,
  category,
  toolContentClassName,
  disableMaxWidth = false,
  hideFindMoreFooter = false,
  ref,
}: ListProps) {
  const { t } = useTranslation()
  const noFilter = !searchText && tags.length === 0
  const hasRes = list.length > 0
  const urlWithSearchText = getMarketplaceCategoryUrl(category, {
    q: searchText,
    tags: tags.join(','),
  })
  const nextToStickyELemRef = useRef<HTMLDivElement>(null)

  const { handleScroll, scrollPosition } = useStickyScroll({
    wrapElemRef,
    nextToStickyELemRef: nextToStickyELemRef as RefObject<HTMLElement>,
  })
  const stickyClassName = useMemo(() => {
    switch (scrollPosition) {
      case ScrollPosition.aboveTheWrap:
        return 'top-0 h-9 pt-3 pb-2 shadow-xs bg-components-panel-bg-blur'
      case ScrollPosition.showing:
        return 'bottom-0 pt-3 pb-1'
      case ScrollPosition.belowTheWrap:
        return 'bottom-0 items-center border-t border-divider-subtle bg-components-panel-bg-blur'
    }
  }, [scrollPosition])

  useImperativeHandle(ref, () => ({
    handleScroll,
  }))

  useEffect(() => {
    handleScroll()
  }, [handleScroll, list])

  const handleScrollToResults = () => {
    nextToStickyELemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (noFilter) {
    if (hideFindMoreFooter) return null

    return (
      <footer className="sticky bottom-0 z-10 flex h-8 items-center border-t border-divider-subtle bg-components-panel-bg-blur px-4 py-1 system-sm-medium">
        <Link
          className="inline-flex items-center rounded-md text-text-accent-light-mode-only focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          href={getMarketplaceCategoryUrl(category)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{t(($) => $.findMoreInMarketplace, { ns: 'plugin' })}</span>
          <span aria-hidden className="ml-0.5 i-ri-arrow-right-up-line size-3" />
        </Link>
      </footer>
    )
  }

  const maxWidthClassName = toolContentClassName || 'max-w-full'

  return (
    <>
      {hasRes && (
        <div
          className={cn(
            'sticky z-10 flex h-8 justify-between px-4 py-1 system-sm-medium text-text-primary',
            stickyClassName,
            !disableMaxWidth && maxWidthClassName,
          )}
        >
          {scrollPosition === ScrollPosition.belowTheWrap ? (
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center rounded-md border-0 bg-transparent p-0 text-left focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
              onClick={handleScrollToResults}
            >
              {t(($) => $.fromMarketplace, { ns: 'plugin' })}
            </button>
          ) : (
            <Link
              href={urlWithSearchText}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 flex-1 items-center rounded-md focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
            >
              {t(($) => $.fromMarketplace, { ns: 'plugin' })}
            </Link>
          )}
          <Link
            href={urlWithSearchText}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 flex shrink-0 items-center rounded-md text-text-accent-light-mode-only focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span>{t(($) => $.searchInMarketplace, { ns: 'plugin' })}</span>
            <span aria-hidden className="ml-0.5 i-ri-arrow-right-up-line size-3" />
          </Link>
        </div>
      )}
      <div className={cn('p-1', !disableMaxWidth && maxWidthClassName)} ref={nextToStickyELemRef}>
        {list.map((item) => (
          <Item key={item.plugin_id} payload={item} />
        ))}
      </div>
    </>
  )
}

export default List
