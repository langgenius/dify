'use client'

import type { PluginCollection, Template, TemplateCollection } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { useLocale, useTranslation } from '#i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowRightSLine } from '@remixicon/react'
import { getLanguage } from '@/i18n-config/language'
import { useMarketplaceMoreClick } from '../atoms'
import CardWrapper from './card-wrapper'
import CollectionList from './collection-list'
import TemplateCard from './template-card'

type BaseProps = {
  cardContainerClassName?: string
}

type PluginsVariant = BaseProps & {
  variant: 'plugins'
  collections: PluginCollection[]
  collectionItemsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
}

type TemplatesVariant = BaseProps & {
  variant: 'templates'
  collections: TemplateCollection[]
  collectionItemsMap: Record<string, Template[]>
}

type ListWithCollectionProps = PluginsVariant | TemplatesVariant

const ListWithCollection = (props: ListWithCollectionProps) => {
  const { variant, cardContainerClassName } = props
  const { t } = useTranslation()

  return (
    <>
      {
        marketplaceCollections.filter((collection) => {
          return marketplaceCollectionPluginsMap[collection.name]?.length
        }).map(collection => (
          <div
            key={collection.name}
            className="py-3"
          >
            <div className="flex items-end justify-between">
              <div>
                <div className="title-xl-semi-bold text-text-primary">{collection.label[getLanguage(locale)]}</div>
                <div className="system-xs-regular text-text-tertiary">{collection.description[getLanguage(locale)]}</div>
              </div>
              {
                collection.searchable && (
                  <div
                    className="flex cursor-pointer items-center system-xs-medium text-text-accent"
                    onClick={() => onMoreClick(collection.search_params)}
                  >
                    {t('marketplace.viewMore', { ns: 'plugin' })}
                    <RiArrowRightSLine className="h-4 w-4" />
                  </div>
                )
              }
            </div>
            <div className={cn(
              'mt-2 grid grid-cols-4 gap-3',
              cardContainerClassName,
            )}
            >
              {
                marketplaceCollectionPluginsMap[collection.name].map((plugin) => {
                  if (cardRender)
                    return cardRender(plugin)

    const renderPluginCard = (plugin: Plugin) => {
      if (cardRender)
        return cardRender(plugin)

      return (
        <CardWrapper
          plugin={plugin}
          showInstallButton={showInstallButton}
        />
      )
    }

    return (
      <CollectionList
        collections={collections}
        collectionItemsMap={collectionItemsMap}
        itemKeyField="plugin_id"
        renderCard={renderPluginCard}
        cardContainerClassName={cardContainerClassName}
      />
    )
  }

  const { collections, collectionItemsMap } = props

  const renderTemplateCard = (template: Template) => (
    <TemplateCard template={template} />
  )

  return (
    <CollectionList
      collections={collections}
      collectionItemsMap={collectionItemsMap}
      itemKeyField="id"
      renderCard={renderTemplateCard}
      viewMoreSearchTab="templates"
      cardContainerClassName={cardContainerClassName}
      emptyText={t('marketplace.noTemplateFound', { ns: 'plugin' })}
    />
  )
}

export default ListWithCollection
