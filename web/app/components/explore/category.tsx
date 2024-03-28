'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import exploreI18n from '@/i18n/en-US/explore'
import type { AppCategory } from '@/models/explore'

const categoryI18n = exploreI18n.category

export type ICategoryProps = {
  className?: string
  list: AppCategory[]
  value: string
  onChange: (value: AppCategory | string) => void
  /**
   * default value for searchparam 'category' in en
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
  const isAllCategories = !list.includes(value)

  const itemClassName = (isSelected: boolean) =>
    cn(
      isSelected
        ? 'bg-white text-primary-600 border-gray-200 font-semibold shadow-[0px_1px_2px_rgba(16,24,40,0.05)]'
        : 'border-transparent font-medium',
      'flex items-center h-7 px-3 border cursor-pointer rounded-lg',
    )

  return (
    <div className={cn(className, 'flex space-x-1 text-[13px] flex-wrap')}>
      <div
        className={itemClassName(isAllCategories)}
        onClick={() => onChange(allCategoriesEn)}
      >
        {t('explore.apps.allCategories')}
      </div>
      {list.map(name => (
        <div
          key={name}
          className={itemClassName(name === value)}
          onClick={() => onChange(name)}
        >
          {categoryI18n[name] ? t(`explore.category.${name}`) : name}
        </div>
      ))}
    </div>
  )
}

export default React.memo(Category)
