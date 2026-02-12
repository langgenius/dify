'use client'

import { useTranslation } from '#i18n'
import {
  useActivePluginCategory,
  useActiveTemplateCategory,
  useCreationType,
  useFilterPluginTags,
} from '../atoms'
import { usePluginCategoryText, useTemplateCategoryText } from '../category-switch/category-text'
import {
  CATEGORY_ALL,
} from '../constants'
import { CREATION_TYPE } from '../search-params'
import SortDropdown from '../sort-dropdown'

const ListTopInfo = () => {
  const creationType = useCreationType()
  const { t } = useTranslation()
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginCategory] = useActivePluginCategory()
  const [activeTemplateCategory] = useActiveTemplateCategory()
  const getPluginCategoryText = usePluginCategoryText()
  const getTemplateCategoryText = useTemplateCategoryText()

  const isPluginsView = creationType === CREATION_TYPE.plugins

  const hasTags = isPluginsView && filterPluginTags.length > 0

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

  const isAllCategory = isPluginsView
    ? activePluginCategory === CATEGORY_ALL
    : activeTemplateCategory === CATEGORY_ALL

  const categoryText = isPluginsView
    ? getPluginCategoryText(activePluginCategory)
    : getTemplateCategoryText(activeTemplateCategory)

  const title = t(
    `marketplace.listTopInfo.${creationType}${isAllCategory ? 'TitleAll' : 'TitleByCategory'}`,
    isAllCategory
      ? { ns: 'plugin' }
      : { ns: 'plugin', category: categoryText },
  )

  return (
    <div className="mb-4 flex items-center justify-between pt-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="title-xl-semi-bold truncate text-text-primary">
          {title}
        </p>
        <p className="system-xs-regular truncate text-text-tertiary">
          {t(`marketplace.listTopInfo.${creationType}Subtitle`, { ns: 'plugin' })}
        </p>
      </div>
      <SortDropdown />
    </div>
  )
}

export default ListTopInfo
