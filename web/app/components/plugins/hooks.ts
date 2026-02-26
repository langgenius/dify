import type { CategoryKey, TagKey } from './constants'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  categoryKeys,
  tagKeys,
} from './constants'
import { PluginCategoryEnum } from './types'

export type Tag = {
  name: TagKey
  label: string
}

export const useTags = () => {
  const { t } = useTranslation()

  const tags = useMemo(() => {
    return tagKeys.map((tag) => {
      return {
        name: tag,
        label: t(`tags.${tag}`, { ns: 'pluginTags' }),
      }
    })
  }, [t])

  const tagsMap = useMemo(() => {
    return tags.reduce((acc, tag) => {
      acc[tag.name] = tag
      return acc
    }, {} as Record<string, Tag>)
  }, [tags])

  const getTagLabel = useMemo(() => {
    return (name: string) => {
      if (!tagsMap[name])
        return name
      return tagsMap[name].label
    }
  }, [tagsMap])

  return {
    tags,
    tagsMap,
    getTagLabel,
  }
}

type Category = {
  name: CategoryKey
  label: string
}

export const useCategories = (isSingle?: boolean) => {
  const { t } = useTranslation()

  const categories = useMemo(() => {
    return categoryKeys.map((category) => {
      if (category === PluginCategoryEnum.agent) {
        return {
          name: PluginCategoryEnum.agent,
          label: isSingle ? t('categorySingle.agent', { ns: 'plugin' }) : t('category.agents', { ns: 'plugin' }),
        }
      }
      return {
        name: category,
        label: isSingle ? t(`categorySingle.${category}`, { ns: 'plugin' }) : t(`category.${category}s`, { ns: 'plugin' }),
      }
    })
  }, [t, isSingle])

  const categoriesMap = useMemo(() => {
    return categories.reduce((acc, category) => {
      acc[category.name] = category
      return acc
    }, {} as Record<string, Category>)
  }, [categories])

  return {
    categories,
    categoriesMap,
  }
}

export const PLUGIN_PAGE_TABS_MAP = {
  plugins: 'plugins',
  marketplace: 'discover',
}

export const usePluginPageTabs = () => {
  const { t } = useTranslation()
  const tabs = [
    { value: PLUGIN_PAGE_TABS_MAP.plugins, text: t('menus.plugins', { ns: 'common' }) },
    { value: PLUGIN_PAGE_TABS_MAP.marketplace, text: t('menus.exploreMarketplace', { ns: 'common' }) },
  ]
  return tabs
}
