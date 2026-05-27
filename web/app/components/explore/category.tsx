'use client'
import type { AppCategory } from '@/models/explore'
import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlDivider, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
import exploreI18n from '@/i18n/en-US/explore.json'
import { ThumbsUp } from '../base/icons/src/vender/line/alertsAndFeedback'

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
      className={cn(className, 'max-w-full overflow-x-auto text-[13px]')}
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
      ].map((item, index, items) => {
        const isSelected = item.isAll ? isAllCategories : item.name === value
        const nextItem = items[index + 1]
        const isNextSelected = nextItem
          ? nextItem.isAll ? isAllCategories : nextItem.name === value
          : false

        return (
          <span key={item.isAll ? 'all' : item.name} className="relative flex items-center">
            <SegmentedControlItem
              value={item.name}
              className="shrink-0 cursor-pointer"
            >
              {item.isAll && (
                <ThumbsUp className="mr-1 size-3.5" aria-hidden="true" />
              )}
              <span className="flex shrink-0 items-center justify-center gap-1 p-0.5">
                {item.label}
              </span>
            </SegmentedControlItem>
            {!isSelected && !isNextSelected && index < items.length - 1 && (
              <SegmentedControlDivider className="absolute top-1/2 -right-px -translate-y-1/2" />
            )}
          </span>
        )
      })}
    </SegmentedControl>
  )
}

export default Category
