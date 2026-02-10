'use client'

import type { Template } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import Empty from '../empty'
import CardWrapper from './card-wrapper'
import { GRID_CLASS } from './collection-list'
import TemplateCard from './template-card'

type PluginsVariant = {
  variant: 'plugins'
  items: Plugin[]
  showInstallButton?: boolean
}

type TemplatesVariant = {
  variant: 'templates'
  items: Template[]
}

type FlatListProps = PluginsVariant | TemplatesVariant

const FlatList = (props: FlatListProps) => {
  if (!props.items.length)
    return <Empty />

  if (props.variant === 'plugins') {
    const { items, showInstallButton } = props
    return (
      <div className={GRID_CLASS}>
        {items.map(plugin => (
          <CardWrapper
            key={`${plugin.org}/${plugin.name}`}
            plugin={plugin}
            showInstallButton={showInstallButton}
          />
        ))}
      </div>
    )
  }

  const { items } = props
  return (
    <div className={GRID_CLASS}>
      {items.map(template => (
        <TemplateCard
          key={template.template_id}
          template={template}
        />
      ))}
    </div>
  )
}

export default FlatList
