import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  categoryKeys,
  tagKeys,
} from './constants'

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
        label: t(`pluginTags.tags.${tag}`),
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

export const useCategories = (translateFromOut?: TFunction) => {
  const { t: translation } = useTranslation()
  const t = translateFromOut || translation

  const categories = useMemo(() => {
    return categoryKeys.map((category) => {
      if (category === 'agent-strategy') {
        return {
          name: 'agent-strategy',
          label: t('plugin.category.agents'),
        }
      }
      return {
        name: category,
        label: t(`plugin.category.${category}s`),
      }
    })
  }, [t])

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

export const useSingleCategories = (translateFromOut?: TFunction) => {
  const { t: translation } = useTranslation()
  const t = translateFromOut || translation

  const categories = useMemo(() => {
    return categoryKeys.map((category) => {
      if (category === 'agent-strategy') {
        return {
          name: 'agent-strategy',
          label: t('plugin.categorySingle.agent'),
        }
      }
      return {
        name: category,
        label: t(`plugin.categorySingle.${category}`),
      }
    })
  }, [t])

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
    { value: PLUGIN_PAGE_TABS_MAP.plugins, text: t('common.menus.plugins') },
    { value: PLUGIN_PAGE_TABS_MAP.marketplace, text: t('common.menus.exploreMarketplace') },
  ]
  return tabs
}
