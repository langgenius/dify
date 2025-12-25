import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  categoryKeys,
  tagKeys,
} from './constants'
import { PluginCategoryEnum } from './types'

export type Tag = {
  name: string
  label: string
}

export const useTags = (translateFromOut?: TFunction) => {
  const { t: translation } = useTranslation()
  const t = translateFromOut || translation

  const tags = useMemo(() => {
    return tagKeys.map((tag) => {
      return {
        name: tag,
        label: t(`pluginTags.tags.${tag}` as any) as string,
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
  name: string
  label: string
}

export const useCategories = (translateFromOut?: TFunction, isSingle?: boolean) => {
  const { t: translation } = useTranslation()
  const t = translateFromOut || translation

  const categories = useMemo(() => {
    return categoryKeys.map((category) => {
      if (category === PluginCategoryEnum.agent) {
        return {
          name: PluginCategoryEnum.agent,
          label: isSingle ? t('plugin.categorySingle.agent') : t('plugin.category.agents'),
        }
      }
      return {
        name: category,
        label: isSingle ? t(`plugin.categorySingle.${category}` as any) as string : t(`plugin.category.${category}s` as any) as string,
      }
    })
  }, [t, isSingle])

  const categoriesMap = useMemo(() => {
    return categories.reduce((acc, category) => {
      acc[category.name] = category as any
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
    { value: PLUGIN_PAGE_TABS_MAP.plugins, text: t('common.menus.plugins') },
    { value: PLUGIN_PAGE_TABS_MAP.marketplace, text: t('common.menus.exploreMarketplace') },
  ]
  return tabs
}
