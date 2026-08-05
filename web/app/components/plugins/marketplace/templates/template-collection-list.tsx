'use client'

import type {
  MarketplaceTemplate,
  MarketplaceTemplateCollection,
} from '@dify/contracts/marketplace'
import { cn } from '@langgenius/dify-ui/cn'
import { useSyncExternalStore } from 'react'
import Link from '@/next/link'
import Carousel from '../list/carousel'
import { CAROUSEL_BREAKPOINTS, CAROUSEL_PAGE_SIZE, GRID_CLASS } from '../list/collection-constants'
import TemplateCard from './template-card'
import { filterTemplatesForLocale, getTemplateCollectionText } from './template-language'

const BECOME_PARTNER_URL = 'https://share-na2.hsforms.com/1NiS4r9lsSqGcuNBB77DeEQ40s9fk'
const PARTNER_COLLECTION_NAMES = new Set(['partners', 'partner-template', 'Partner Template'])

type TemplateCollectionListProps = {
  becomePartnerText: string
  collections: MarketplaceTemplateCollection[]
  locale: string
  partnerText: string
  templatesByCollection: Record<string, MarketplaceTemplate[]>
  viewMoreText: string
}

function subscribeToViewport(onStoreChange: () => void) {
  globalThis.window?.addEventListener('resize', onStoreChange)

  return () => globalThis.window?.removeEventListener('resize', onStoreChange)
}

const getViewportWidth = () => globalThis.window?.innerWidth ?? CAROUSEL_BREAKPOINTS.xl
const getServerViewportWidth = () => CAROUSEL_BREAKPOINTS.xl

function getCarouselItemsPerPage(viewportWidth: number) {
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.xl) return CAROUSEL_PAGE_SIZE.xl
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.lg) return CAROUSEL_PAGE_SIZE.lg
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.sm) return CAROUSEL_PAGE_SIZE.sm

  return CAROUSEL_PAGE_SIZE.base
}

function getViewMoreHref(collection: MarketplaceTemplateCollection) {
  const searchParams = new URLSearchParams({ view: 'search' })
  const collectionSearch = collection.search_params

  if (collectionSearch?.query) searchParams.set('q', collectionSearch.query)
  if (collectionSearch?.sort_by) searchParams.set('sort_by', collectionSearch.sort_by)
  if (collectionSearch?.sort_order) searchParams.set('sort_order', collectionSearch.sort_order)

  return `/templates/all?${searchParams.toString()}`
}

export default function TemplateCollectionList({
  becomePartnerText,
  collections,
  locale,
  partnerText,
  templatesByCollection,
  viewMoreText,
}: TemplateCollectionListProps) {
  const viewportWidth = useSyncExternalStore(
    subscribeToViewport,
    getViewportWidth,
    getServerViewportWidth,
  )
  const itemsPerPage = getCarouselItemsPerPage(viewportWidth)

  return collections.map((collection) => {
    const templates = filterTemplatesForLocale(templatesByCollection[collection.name] ?? [], locale)

    if (!templates.length) return null

    const carouselPages = Array.from(
      { length: Math.ceil(templates.length / itemsPerPage) },
      (_, pageIndex) => {
        const pageTemplates = templates.slice(
          pageIndex * itemsPerPage,
          (pageIndex + 1) * itemsPerPage,
        )

        return {
          id: `${collection.name}-${itemsPerPage}-${pageIndex}`,
          content: (
            <div className={cn(GRID_CLASS)}>
              {pageTemplates.map((template) => (
                <div key={template.id} className="min-w-0 *:w-full">
                  <TemplateCard partnerText={partnerText} template={template} />
                </div>
              ))}
            </div>
          ),
        }
      },
    )
    const isPartnerCollection = PARTNER_COLLECTION_NAMES.has(collection.name)

    return (
      <section key={collection.name} className="py-3">
        <div className="mb-2 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="title-xl-semi-bold text-text-primary">
              {getTemplateCollectionText(collection.label, locale)}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 system-xs-regular text-text-tertiary">
              <span>{getTemplateCollectionText(collection.description, locale)}</span>
              {isPartnerCollection && (
                <>
                  <span className="text-divider-regular">|</span>
                  <a
                    href={BECOME_PARTNER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-x-0.5 text-text-accent hover:underline"
                  >
                    <span>{becomePartnerText}</span>
                    <span aria-hidden className="i-ri-external-link-line size-3" />
                  </a>
                </>
              )}
            </div>
          </div>
          {collection.searchable && (
            <Link
              href={getViewMoreHref(collection)}
              className="flex shrink-0 items-center system-xs-medium text-text-accent hover:underline"
            >
              {viewMoreText}
              <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
            </Link>
          )}
        </div>
        {collection.searchable ? (
          <div className={GRID_CLASS}>
            {templates.slice(0, 4).map((template) => (
              <TemplateCard key={template.id} partnerText={partnerText} template={template} />
            ))}
          </div>
        ) : (
          <Carousel
            pages={carouselPages}
            showNavigation
            showPagination
            autoPlay
            autoPlayInterval={5000}
            pauseWhenOffscreen
          />
        )}
      </section>
    )
  })
}
