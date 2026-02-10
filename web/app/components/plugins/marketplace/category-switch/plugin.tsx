'use client'

import type { ActivePluginType } from '../constants'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useTranslation } from '#i18n'
import { RiArchive2Line } from '@remixicon/react'
import { useSetAtom } from 'jotai'
import { Plugin } from '@/app/components/base/icons/src/vender/plugin'
import { searchModeAtom, useActivePluginCategory, useFilterPluginTags } from '../atoms'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP } from '../constants'
import { MARKETPLACE_TYPE_ICON_COMPONENTS } from '../plugin-type-icons'
import { CommonCategorySwitch } from './common'
import HeroTagsFilter from './hero-tags-filter'

type PluginTypeSwitchProps = {
  className?: string
  variant?: 'default' | 'hero'
}

const getTypeIcon = (value: ActivePluginType, isHeroVariant?: boolean) => {
  if (value === PLUGIN_TYPE_SEARCH_MAP.all)
    return isHeroVariant ? <Plugin className="mr-1.5 h-4 w-4" /> : null
  if (value === PLUGIN_TYPE_SEARCH_MAP.bundle)
    return <RiArchive2Line className="mr-1.5 h-4 w-4" />
  const Icon = MARKETPLACE_TYPE_ICON_COMPONENTS[value as PluginCategoryEnum]
  return Icon ? <Icon className="mr-1.5 h-4 w-4" /> : null
}

export const PluginCategorySwitch = ({
  className,
  variant = 'default',
}: PluginTypeSwitchProps) => {
  const { t } = useTranslation()
  const [activePluginCategory, handleActivePluginCategoryChange] = useActivePluginCategory()
  const [filterPluginTags, setFilterPluginTags] = useFilterPluginTags()
  const setSearchMode = useSetAtom(searchModeAtom)

  const isHeroVariant = variant === 'hero'

  const options = [
    {
      value: PLUGIN_TYPE_SEARCH_MAP.all,
      text: isHeroVariant ? t('category.allTypes', { ns: 'plugin' }) : t('category.all', { ns: 'plugin' }),
      icon: getTypeIcon(PLUGIN_TYPE_SEARCH_MAP.all, isHeroVariant),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.model,
      text: t('category.models', { ns: 'plugin' }),
      icon: getTypeIcon(PLUGIN_TYPE_SEARCH_MAP.model, isHeroVariant),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.tool,
      text: t('category.tools', { ns: 'plugin' }),
      icon: getTypeIcon(PLUGIN_TYPE_SEARCH_MAP.tool, isHeroVariant),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.datasource,
      text: t('category.datasources', { ns: 'plugin' }),
      icon: getTypeIcon(PLUGIN_TYPE_SEARCH_MAP.datasource, isHeroVariant),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.trigger,
      text: t('category.triggers', { ns: 'plugin' }),
      icon: getTypeIcon(PLUGIN_TYPE_SEARCH_MAP.trigger, isHeroVariant),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.agent,
      text: t('category.agents', { ns: 'plugin' }),
      icon: getTypeIcon(PLUGIN_TYPE_SEARCH_MAP.agent, isHeroVariant),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.extension,
      text: t('category.extensions', { ns: 'plugin' }),
      icon: getTypeIcon(PLUGIN_TYPE_SEARCH_MAP.extension, isHeroVariant),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.bundle,
      text: t('category.bundles', { ns: 'plugin' }),
      icon: getTypeIcon(PLUGIN_TYPE_SEARCH_MAP.bundle, isHeroVariant),
    },
  ]

  const handleChange = (value: string) => {
    handleActivePluginCategoryChange(value)
    if (PLUGIN_CATEGORY_WITH_COLLECTIONS.has(value as ActivePluginType)) {
      setSearchMode(null)
    }
  }

  if (!isHeroVariant) {
    return (
      <CommonCategorySwitch
        className={className}
        variant={variant}
        options={options}
        activeValue={activePluginCategory}
        onChange={handleChange}
      />
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <HeroTagsFilter
        tags={filterPluginTags}
        onTagsChange={tags => setFilterPluginTags(tags.length ? tags : null)}
      />
      <div className="text-text-primary-on-surface">
        ·
      </div>
      <CommonCategorySwitch
        className={className}
        variant={variant}
        options={options}
        activeValue={activePluginCategory}
        onChange={handleChange}
      />
    </div>
  )
}
