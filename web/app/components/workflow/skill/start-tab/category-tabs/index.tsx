'use client'

import type { FC } from 'react'
import { memo } from 'react'
import TabItem from './tab-item'

export type TemplateCategory = {
  id: string
  label: string
}
// TODO: use real categories from backend
const MOCK_CATEGORIES: TemplateCategory[] = [
  { id: 'all', label: 'All' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'search', label: 'Search' },
  { id: 'development', label: 'Development' },
  { id: 'security', label: 'Security' },
]

type CategoryTabsProps = {
  categories?: TemplateCategory[]
  activeCategory: string
  onCategoryChange: (categoryId: string) => void
}

const CategoryTabs: FC<CategoryTabsProps> = ({
  categories = MOCK_CATEGORIES,
  activeCategory,
  onCategoryChange,
}) => {
  return (
    <div className="flex flex-1 items-center gap-1">
      {categories.map(category => (
        <TabItem
          key={category.id}
          label={category.label}
          isActive={activeCategory === category.id}
          onClick={() => onCategoryChange(category.id)}
        />
      ))}
    </div>
  )
}

export default memo(CategoryTabs)
