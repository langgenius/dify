'use client'

import type { ActivePluginType } from '../constants'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { RiArchive2Line } from '@remixicon/react'
import { useSetAtom } from 'jotai'
import { Plugin } from '@/app/components/base/icons/src/vender/plugin'
import { searchModeAtom, useActivePluginCategory, useFilterPluginTags } from '../atoms'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP } from '../constants'
import { MARKETPLACE_TYPE_ICON_COMPONENTS } from '../plugin-type-icons'
import { usePluginCategoryText } from './category-text'
import { CommonCategorySwitch } from './common'
import HeroTagsFilter from './hero-tags-filter'

type PluginTypeSwitchProps = {
  className?: string
  variant?: 'default' | 'hero'
}

const categoryValues = [
  PLUGIN_TYPE_SEARCH_MAP.all,
  PLUGIN_TYPE_SEARCH_MAP.model,
  PLUGIN_TYPE_SEARCH_MAP.tool,
  PLUGIN_TYPE_SEARCH_MAP.datasource,
  PLUGIN_TYPE_SEARCH_MAP.trigger,
  PLUGIN_TYPE_SEARCH_MAP.agent,
  PLUGIN_TYPE_SEARCH_MAP.extension,
  PLUGIN_TYPE_SEARCH_MAP.bundle,
] as const

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
  const [activePluginCategory, handleActivePluginCategoryChange] = useActivePluginCategory()
  const [filterPluginTags, setFilterPluginTags] = useFilterPluginTags()
  const setSearchMode = useSetAtom(searchModeAtom)
  const getPluginCategoryText = usePluginCategoryText()

  const isHeroVariant = variant === 'hero'

  const options = categoryValues.map(value => ({
    value,
    text: getPluginCategoryText(value, isHeroVariant),
    icon: getTypeIcon(value, isHeroVariant),
  }))

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
