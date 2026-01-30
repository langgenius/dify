'use client'

import { memo } from 'react'
import TabItem from './tab-item'

export type TemplateCategory = {
  id: string
  label: string
}
const CATEGORIES: TemplateCategory[] = [
  { id: 'all', label: 'All' },
  { id: 'document', label: 'Document' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'development', label: 'Development' },
  { id: 'design', label: 'Design' },
  { id: 'creative', label: 'Creative' },
]

type CategoryTabsProps = {
  categories?: TemplateCategory[]
  activeCategory: string
  onCategoryChange: (categoryId: string) => void
}

const CategoryTabs = ({
  categories = CATEGORIES,
  activeCategory,
  onCategoryChange,
}: CategoryTabsProps) => {
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
