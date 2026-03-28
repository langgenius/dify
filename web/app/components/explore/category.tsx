'use client'
import type { FC } from 'react'
import type { AppCategory } from '@/models/explore'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ThumbsUp } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import exploreI18n from '@/i18n/en-US/explore.json'
import { cn } from '@/utils/classnames'

export type ICategoryProps = {
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
    'system-sm-medium flex h-7 cursor-pointer items-center rounded-lg border border-transparent  px-3 text-text-tertiary hover:bg-components-main-nav-nav-button-bg-active',
    isSelected && 'border-components-main-nav-nav-button-border bg-components-main-nav-nav-button-bg-active text-components-main-nav-nav-button-text-active shadow-xs',
  )

  return (
    <div className={cn(className, 'flex flex-wrap gap-1 text-[13px]')}>
      <div
        className={itemClassName(isAllCategories)}
        onClick={() => onChange(allCategoriesEn)}
      >
        <ThumbsUp className="mr-1 h-3.5 w-3.5" />
        {t('apps.allCategories', { ns: 'explore' })}
      </div>
      {list.filter(name => name !== allCategoriesEn).map(name => (
        <div
          key={name}
          className={itemClassName(name === value)}
          onClick={() => onChange(name)}
        >
          {`category.${name}` in exploreI18n ? t(`category.${name}`, { ns: 'explore' }) : name}
        </div>
      ))}
    </div>
  )
}

export default React.memo(Category)
