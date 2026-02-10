'use client'

import { useTranslation } from '#i18n'
import { RiFileList3Line } from '@remixicon/react'
import { useActiveTemplateCategory } from './atoms'
import CategorySwitch from './category-switch'
import { CATEGORY_ALL, TEMPLATE_CATEGORY_MAP } from './constants'
import { Playground } from '@/app/components/base/icons/src/vender/plugin'

type TemplateCategorySwitchProps = {
  className?: string
  variant?: 'default' | 'hero'
}

const TemplateCategorySwitch = ({
  className,
  variant = 'default',
}: TemplateCategorySwitchProps) => {
  const { t } = useTranslation()
  const [activeTemplateCategory, handleActiveTemplateCategoryChange] = useActiveTemplateCategory()

  const isHeroVariant = variant === 'hero'

  const options = [
    {
      value: CATEGORY_ALL,
      text: t('marketplace.templateCategory.all', { ns: 'plugin' }),
      icon: isHeroVariant ? <Playground className="mr-1.5 h-4 w-4" /> : null,
    },
    {
      value: TEMPLATE_CATEGORY_MAP.marketing,
      text: t('marketplace.templateCategory.marketing', { ns: 'plugin' }),
      icon: null,
    },
    {
      value: TEMPLATE_CATEGORY_MAP.sales,
      text: t('marketplace.templateCategory.sales', { ns: 'plugin' }),
      icon: null,
    },
    {
      value: TEMPLATE_CATEGORY_MAP.support,
      text: t('marketplace.templateCategory.support', { ns: 'plugin' }),
      icon: null,
    },
    {
      value: TEMPLATE_CATEGORY_MAP.operations,
      text: t('marketplace.templateCategory.operations', { ns: 'plugin' }),
      icon: null,
    },
    {
      value: TEMPLATE_CATEGORY_MAP.it,
      text: t('marketplace.templateCategory.it', { ns: 'plugin' }),
      icon: null,
    },
    {
      value: TEMPLATE_CATEGORY_MAP.knowledge,
      text: t('marketplace.templateCategory.knowledge', { ns: 'plugin' }),
      icon: null,
    },
    {
      value: TEMPLATE_CATEGORY_MAP.design,
      text: t('marketplace.templateCategory.design', { ns: 'plugin' }),
      icon: null,
    },
  ]

  return (
    <CategorySwitch
      className={className}
      variant={variant}
      options={options}
      activeValue={activeTemplateCategory}
      onChange={handleActiveTemplateCategoryChange}
    />
  )
}

export default TemplateCategorySwitch
