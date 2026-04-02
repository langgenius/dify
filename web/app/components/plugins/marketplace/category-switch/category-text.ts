'use client'

import type { ActivePluginType, ActiveTemplateCategory } from '../constants'
import { useTranslation } from '#i18n'
import { PLUGIN_TYPE_SEARCH_MAP, TEMPLATE_CATEGORY_MAP } from '../constants'

/**
 * Returns a getter that translates a plugin category value to its display text.
 * Pass `allAsAllTypes = true` to use "All types" instead of "All" for the `all` category
 * (e.g. hero variant in category switch).
 */
export function usePluginCategoryText() {
  const { t } = useTranslation()

  return (category: ActivePluginType, allAsAllTypes = false): string => {
    switch (category) {
      case PLUGIN_TYPE_SEARCH_MAP.model:
        return t('category.models', { ns: 'plugin' })
      case PLUGIN_TYPE_SEARCH_MAP.tool:
        return t('category.tools', { ns: 'plugin' })
      case PLUGIN_TYPE_SEARCH_MAP.datasource:
        return t('category.datasources', { ns: 'plugin' })
      case PLUGIN_TYPE_SEARCH_MAP.trigger:
        return t('category.triggers', { ns: 'plugin' })
      case PLUGIN_TYPE_SEARCH_MAP.agent:
        return t('category.agents', { ns: 'plugin' })
      case PLUGIN_TYPE_SEARCH_MAP.extension:
        return t('category.extensions', { ns: 'plugin' })
      case PLUGIN_TYPE_SEARCH_MAP.bundle:
        return t('category.bundles', { ns: 'plugin' })
      case PLUGIN_TYPE_SEARCH_MAP.all:
      default:
        return allAsAllTypes
          ? t('category.allTypes', { ns: 'plugin' })
          : t('category.all', { ns: 'plugin' })
    }
  }
}

/**
 * Returns a getter that translates a template category value to its display text.
 */
export function useTemplateCategoryText() {
  const { t } = useTranslation()

  return (category: ActiveTemplateCategory): string => {
    switch (category) {
      case TEMPLATE_CATEGORY_MAP.marketing:
        return t('marketplace.templateCategory.marketing', { ns: 'plugin' })
      case TEMPLATE_CATEGORY_MAP.sales:
        return t('marketplace.templateCategory.sales', { ns: 'plugin' })
      case TEMPLATE_CATEGORY_MAP.support:
        return t('marketplace.templateCategory.support', { ns: 'plugin' })
      case TEMPLATE_CATEGORY_MAP.operations:
        return t('marketplace.templateCategory.operations', { ns: 'plugin' })
      case TEMPLATE_CATEGORY_MAP.it:
        return t('marketplace.templateCategory.it', { ns: 'plugin' })
      case TEMPLATE_CATEGORY_MAP.knowledge:
        return t('marketplace.templateCategory.knowledge', { ns: 'plugin' })
      case TEMPLATE_CATEGORY_MAP.design:
        return t('marketplace.templateCategory.design', { ns: 'plugin' })
      case TEMPLATE_CATEGORY_MAP.all:
      default:
        return t('marketplace.templateCategory.all', { ns: 'plugin' })
    }
  }
}
