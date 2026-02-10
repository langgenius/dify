'use client'

import type { PluginCollection, Template, TemplateCollection } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import CardWrapper from './card-wrapper'
import { CAROUSEL_COLLECTION_NAMES } from './collection-constants'
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

  if (variant === 'plugins') {
    const {
      collections,
      collectionItemsMap,
      showInstallButton,
      cardRender,
    } = props

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
        carouselCollectionNames={[CAROUSEL_COLLECTION_NAMES.partners]}
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
      carouselCollectionNames={[CAROUSEL_COLLECTION_NAMES.featured]}
      viewMoreSearchTab="templates"
      cardContainerClassName={cardContainerClassName}
    />
  )
}

export default ListWithCollection
