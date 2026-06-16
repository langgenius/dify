'use client'
import type { AppCategory } from '@/models/explore'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioRoot } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useTranslation } from 'react-i18next'
import exploreI18n from '@/i18n/en-US/explore.json'

type ICategoryProps = {
  className?: string
  list: AppCategory[]
  value: string
  onChange: (value: AppCategory | string) => void
  /**
   * default value for search param 'category' in en
   */
  allCategoriesEn: string
}

function Category({
  className,
  list,
  value,
  onChange,
  allCategoriesEn,
}: ICategoryProps) {
  const { t } = useTranslation()
  const isAllCategories = !list.includes(value as AppCategory) || value === allCategoriesEn
  const selectedCategory = isAllCategories ? allCategoriesEn : value

  const renderCategoryName = (name: AppCategory) => {
    const categoryKey = `category.${name}` as keyof typeof exploreI18n
    return categoryKey in exploreI18n ? t(categoryKey, { ns: 'explore' }) : name
  }

  const handleValueChange = (nextCategory: string) => {
    if (nextCategory)
      onChange(nextCategory)
  }

  return (
    <RadioGroup
      aria-label={t('tryApp.category', { ns: 'explore' })}
      className={cn(className, 'flex max-w-full flex-wrap items-start gap-1 overflow-visible rounded-none bg-transparent p-0 text-[13px]')}
      value={selectedCategory}
      onValueChange={handleValueChange}
    >
      {[
        { name: allCategoriesEn, label: t('apps.allCategories', { ns: 'explore' }), isAll: true },
        ...list.filter(name => name !== allCategoriesEn).map(name => ({
          name,
          label: renderCategoryName(name),
          isAll: false,
        })),
      ].map(item => (
        <RadioRoot
          key={item.isAll ? 'all' : item.name}
          value={item.name}
          variant="unstyled"
          nativeButton
          render={<button type="button" />}
          className="h-8 min-w-12 shrink-0 cursor-pointer touch-manipulation rounded-lg border-0 px-2.5 py-2 text-center system-sm-medium text-text-tertiary shadow-none transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-checked:border-0 data-checked:bg-state-base-active data-checked:system-sm-semibold data-checked:text-text-secondary data-checked:shadow-none motion-reduce:transition-none"
        >
          {item.label}
        </RadioRoot>
      ))}
    </RadioGroup>
  )
}

export default Category
