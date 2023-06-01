'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import exploreI18n from '@/i18n/lang/explore.en'

const categoryI18n = exploreI18n.category

export type ICategoryProps = {
  className?: string
  list: string[]
  value: string
  onChange: (value: string) => void
}

const Category: FC<ICategoryProps> = ({
  className,
  list,
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  const itemClassName = (isSelected: boolean) => cn(isSelected ? 'bg-white text-primary-600 border-gray-200 font-semibold' : 'border-transparent font-medium', 'flex items-center h-7 px-3 border cursor-pointer rounded-lg')
  const itemStyle = (isSelected: boolean) => isSelected ? { boxShadow: '0px 1px 2px rgba(16, 24, 40, 0.05)' } : {}
  return (
    <div className={cn(className, 'flex space-x-1 text-[13px]')}>
      <div
        className={itemClassName(value === '')}
        style={itemStyle(value === '')}
        onClick={() => onChange('')}
      >
        {t('explore.apps.allCategories')}
      </div>
      {list.map(name => (
        <div
          key={name}
          className={itemClassName(name === value)}
          style={itemStyle(name === value)}
          onClick={() => onChange(name)}
        >
          {(categoryI18n as any)[name] ? t(`explore.category.${name}`) : name}
        </div>
      ))}
    </div>
  )
}
export default React.memo(Category)
