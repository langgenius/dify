'use client'

import { useTranslation } from '#i18n'
import {
  useActivePluginCategory,
  useActiveTemplateCategory,
  useFilterPluginTags,
} from '../atoms'
import { usePluginCategoryText, useTemplateCategoryText } from '../category-switch/category-text'
import {
  CATEGORY_ALL,
  TEMPLATE_CATEGORY_MAP,
} from '../constants'
import SortDropdown from '../sort-dropdown'

type ListTopInfoProps = {
  variant: 'plugins' | 'templates'
}

const ListTopInfo = ({ variant }: ListTopInfoProps) => {
  const { t } = useTranslation()
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginCategory] = useActivePluginCategory()
  const [activeTemplateCategory] = useActiveTemplateCategory()
  const getPluginCategoryText = usePluginCategoryText()
  const getTemplateCategoryText = useTemplateCategoryText()

  const hasTags = variant === 'plugins' && filterPluginTags.length > 0

  if (hasTags) {
    return (
      <div className="mb-4 flex items-center justify-between pt-3">
        <p className="title-xl-semi-bold text-text-primary">
          {t('marketplace.listTopInfo.tagsTitle', { ns: 'plugin' })}
        </p>
        <SortDropdown />
      </div>
    )
  }

  const isPlugins = variant === 'plugins'
  const isAllCategory = isPlugins
    ? activePluginCategory === CATEGORY_ALL
    : activeTemplateCategory === TEMPLATE_CATEGORY_MAP.all

  const categoryText = isPlugins
    ? getPluginCategoryText(activePluginCategory)
    : getTemplateCategoryText(activeTemplateCategory)

  const title = isPlugins
    ? isAllCategory
      ? t('marketplace.listTopInfo.pluginsTitleAll', { ns: 'plugin' })
      : t('marketplace.listTopInfo.pluginsTitleByCategory', { ns: 'plugin', category: categoryText })
    : isAllCategory
      ? t('marketplace.listTopInfo.templatesTitleAll', { ns: 'plugin' })
      : t('marketplace.listTopInfo.templatesTitleByCategory', { ns: 'plugin', category: categoryText })

  const subtitleKey = isPlugins
    ? 'marketplace.listTopInfo.pluginsSubtitle'
    : 'marketplace.listTopInfo.templatesSubtitle'

  return (
    <div className="mb-4 flex items-center justify-between pt-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="title-xl-semi-bold truncate text-text-primary">
          {title}
        </p>
        <p className="system-xs-regular truncate text-text-tertiary">
          {t(subtitleKey, { ns: 'plugin' })}
        </p>
      </div>
      <SortDropdown />
    </div>
  )
}

export default ListTopInfo
