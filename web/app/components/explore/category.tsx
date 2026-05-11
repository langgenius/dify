'use client'
import type { FC } from 'react'
import type { AppCategory } from '@/models/explore'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
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

const Category: FC<ICategoryProps> = ({
  className,
  list,
  value,
  onChange,
  allCategoriesEn,
}) => {
  const { t } = useTranslation()
  const isAllCategories = !list.includes(value as AppCategory) || value === allCategoriesEn

  const itemClassName = (isSelected: boolean) => cn(
    'relative flex h-7 shrink-0 cursor-pointer items-center justify-center gap-0.5 overflow-hidden rounded-lg border-[0.5px] border-transparent px-2 py-1 system-sm-medium whitespace-nowrap text-text-secondary',
    isSelected && 'border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-xs shadow-shadow-shadow-3',
  )

  const renderCategoryName = (name: AppCategory) => {
    const categoryKey = `category.${name}` as keyof typeof exploreI18n
    return categoryKey in exploreI18n ? t(categoryKey, { ns: 'explore' }) : name
  }

  return (
    <div className={cn(className, 'inline-flex max-w-full items-center gap-px overflow-x-auto rounded-[10px] bg-components-segmented-control-bg-normal p-0.5 text-[13px]')}>
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
          <div key={item.isAll ? 'all' : item.name} className="relative flex items-center">
            <div
              className={itemClassName(isSelected)}
              onClick={() => onChange(item.name)}
            >
              {item.isAll && (
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <span className="i-custom-vender-line-alertsAndFeedback-thumbs-up h-4 w-4" />
                </span>
              )}
              <span className="flex shrink-0 items-center justify-center gap-1 p-0.5">
                {item.label}
              </span>
            </div>
            {!isSelected && !isNextSelected && index < items.length - 1 && (
              <div className="absolute top-1/2 right-[-1px] h-3.5 w-px -translate-y-1/2 bg-divider-regular" />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(Category)
