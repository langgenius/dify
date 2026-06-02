'use client'
import type { AppCategory } from '@/models/explore'
import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
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

  const handleValueChange = (nextCategories: string[]) => {
    const nextCategory = nextCategories[0]

    if (nextCategory)
      onChange(nextCategory)
  }

  return (
    <SegmentedControl
      aria-label={t('tryApp.category', { ns: 'explore' })}
      className={cn(className, 'flex max-w-full flex-wrap items-start gap-1 overflow-visible rounded-none bg-transparent p-0 text-[13px]')}
      value={[selectedCategory]}
      onValueChange={handleValueChange}
    >
      {[
        { name: allCategoriesEn, label: t('apps.allCategories', { ns: 'explore' }), isAll: true },
        ...list.filter(name => name !== allCategoriesEn).map(name => ({
          name,
          label: renderCategoryName(name),
          isAll: false,
        })),
      ].map((item) => {
        const isSelected = item.isAll ? isAllCategories : item.name === value

        return (
          <SegmentedControlItem
            key={item.isAll ? 'all' : item.name}
            value={item.name}
            className={cn(
              'h-8 min-w-12 shrink-0 cursor-pointer rounded-lg border-0 px-2.5 py-2 text-center shadow-none hover:bg-state-base-hover focus-visible:ring-1 data-pressed:border-0 data-pressed:bg-state-base-active data-pressed:text-text-secondary data-pressed:shadow-none',
              isSelected ? 'system-sm-semibold text-text-secondary' : 'system-sm-medium text-text-tertiary',
            )}
          >
            {item.label}
          </SegmentedControlItem>
        )
      })}
    </SegmentedControl>
  )
}

export default Category
