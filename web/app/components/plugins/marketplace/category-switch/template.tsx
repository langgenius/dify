'use client'

import { Playground } from '@/app/components/base/icons/src/vender/plugin'
import { useActiveTemplateCategory, useFilterTemplateLanguages } from '../atoms'
import { CATEGORY_ALL, TEMPLATE_CATEGORY_MAP } from '../constants'
import { useTemplateCategoryText } from './category-text'
import { CommonCategorySwitch } from './common'
import HeroLanguagesFilter from './hero-languages-filter'

type TemplateCategorySwitchProps = {
  className?: string
  variant?: 'default' | 'hero'
}

const categoryValues = [
  CATEGORY_ALL,
  TEMPLATE_CATEGORY_MAP.marketing,
  TEMPLATE_CATEGORY_MAP.sales,
  TEMPLATE_CATEGORY_MAP.support,
  TEMPLATE_CATEGORY_MAP.operations,
  TEMPLATE_CATEGORY_MAP.it,
  TEMPLATE_CATEGORY_MAP.knowledge,
  TEMPLATE_CATEGORY_MAP.design,
] as const

export const TemplateCategorySwitch = ({
  className,
  variant = 'default',
}: TemplateCategorySwitchProps) => {
  const [activeTemplateCategory, handleActiveTemplateCategoryChange] = useActiveTemplateCategory()
  const [filterTemplateLanguages, setFilterTemplateLanguages] = useFilterTemplateLanguages()
  const getTemplateCategoryText = useTemplateCategoryText()

  const isHeroVariant = variant === 'hero'

  const options = categoryValues.map(value => ({
    value,
    text: getTemplateCategoryText(value),
    icon: value === CATEGORY_ALL && isHeroVariant ? <Playground className="mr-1.5 h-4 w-4" /> : null,
  }))

  if (!isHeroVariant) {
    return (
      <CommonCategorySwitch
        className={className}
        variant={variant}
        options={options}
        activeValue={activeTemplateCategory}
        onChange={handleActiveTemplateCategoryChange}
      />
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <HeroLanguagesFilter
        languages={filterTemplateLanguages}
        onLanguagesChange={languages => setFilterTemplateLanguages(languages.length ? languages : null)}
      />
      <div className="text-text-primary-on-surface">
        ·
      </div>
      <CommonCategorySwitch
        className={className}
        variant={variant}
        options={options}
        activeValue={activeTemplateCategory}
        onChange={handleActiveTemplateCategoryChange}
      />
    </div>
  )
}
