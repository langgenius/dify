'use client'

import type { Template, TemplateCollection } from '../types'
import { useLocale, useTranslation } from '#i18n'
import { RiArrowRightSLine } from '@remixicon/react'
import { getLanguage } from '@/i18n-config/language'
import Empty from '../empty'
import Carousel from './carousel'
import TemplateCard from './template-card'

type TemplateListProps = {
  templateCollections: TemplateCollection[]
  templateCollectionTemplatesMap: Record<string, Template[]>
  cardContainerClassName?: string
}

const FEATURED_COLLECTION_NAME = 'featured'
const GRID_DISPLAY_LIMIT = 8

const TemplateList = ({
  templateCollections,
  templateCollectionTemplatesMap,
  cardContainerClassName,
}: TemplateListProps) => {
  const { t } = useTranslation()
  const locale = useLocale()

  const renderTemplateCard = (template: Template) => {
    return (
      <TemplateCard
        key={template.template_id}
        template={template}
      />
    )
  }

  const renderFeaturedCarousel = (collection: TemplateCollection, templates: Template[]) => {
    // Featured collection: 2-row carousel with auto-play
    const rows: Template[][] = []
    for (let i = 0; i < templates.length; i += 2) {
      rows.push(templates.slice(i, i + 2))
    }

    return (
      <Carousel
        className={cardContainerClassName}
        showNavigation={templates.length > 8}
        showPagination={templates.length > 8}
        autoPlay={templates.length > 8}
        autoPlayInterval={5000}
      >
        {rows.map(columnTemplates => (
          <div
            key={`column-${columnTemplates[0]?.template_id}`}
            className="flex w-[calc((100%-0px)/1)] shrink-0 flex-col gap-3 sm:w-[calc((100%-12px)/2)] lg:w-[calc((100%-24px)/3)] xl:w-[calc((100%-36px)/4)]"
            style={{ scrollSnapAlign: 'start' }}
          >
            {columnTemplates.map(template => (
              <div key={template.template_id}>
                {renderTemplateCard(template)}
              </div>
            ))}
          </div>
        ))}
      </Carousel>
    )
  }

  const renderGridCollection = (collection: TemplateCollection, templates: Template[]) => {
    const displayTemplates = templates.slice(0, GRID_DISPLAY_LIMIT)

    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {displayTemplates.map(template => (
          <div key={template.template_id}>
            {renderTemplateCard(template)}
          </div>
        ))}
      </div>
    )
  }

  const collectionsWithTemplates = templateCollections.filter((collection) => {
    return templateCollectionTemplatesMap[collection.name]?.length
  })

  if (collectionsWithTemplates.length === 0) {
    return <Empty />
  }

  return (
    <>
      {
        collectionsWithTemplates.map((collection) => {
          const templates = templateCollectionTemplatesMap[collection.name]
          const isFeaturedCollection = collection.name === FEATURED_COLLECTION_NAME
          const showViewMore = collection.searchable && (isFeaturedCollection || templates.length > GRID_DISPLAY_LIMIT)

          return (
            <div
              key={collection.name}
              className="py-3"
            >
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <div className="title-xl-semi-bold text-text-primary">{collection.label[getLanguage(locale)]}</div>
                  <div className="system-xs-regular text-text-tertiary">{collection.description[getLanguage(locale)]}</div>
                </div>
                {showViewMore && (
                  <div
                    className="system-xs-medium flex cursor-pointer items-center text-text-accent"
                  >
                    {t('marketplace.viewMore', { ns: 'plugin' })}
                    <RiArrowRightSLine className="h-4 w-4" />
                  </div>
                )}
              </div>
              {isFeaturedCollection
                ? renderFeaturedCarousel(collection, templates)
                : renderGridCollection(collection, templates)}
            </div>
          )
        })
      }
    </>
  )
}

export default TemplateList
