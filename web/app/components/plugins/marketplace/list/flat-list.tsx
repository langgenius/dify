'use client'

import type { Template } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { useTranslation } from '#i18n'
import Empty from '../empty'
import CardWrapper from './card-wrapper'
import { GRID_CLASS } from './collection-constants'
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
  const { items, variant } = props
  const { t } = useTranslation()

  if (!items.length) {
    if (variant === 'templates')
      return <Empty text={t('marketplace.noTemplateFound', { ns: 'plugin' })} />
    return <Empty />
  }

  if (variant === 'plugins') {
    const { showInstallButton } = props
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

  return (
    <div className={GRID_CLASS}>
      {items.map(template => (
        <TemplateCard
          key={template.id}
          template={template}
        />
      ))}
    </div>
  )
}

export default FlatList
