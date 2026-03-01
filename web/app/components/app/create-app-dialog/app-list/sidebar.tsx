'use client'
import { RiStickyNoteAddLine, RiThumbUpLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { cn } from '@/utils/classnames'

export enum AppCategories {
  RECOMMENDED = 'Recommended',
}

type SidebarProps = {
  current: AppCategories | string
  categories: string[]
  onClick?: (category: AppCategories | string) => void
  onCreateFromBlank?: () => void
}

export default function Sidebar({ current, categories, onClick, onCreateFromBlank }: SidebarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col">
      <ul className="pt-0.5">
        <CategoryItem category={AppCategories.RECOMMENDED} active={current === AppCategories.RECOMMENDED} onClick={onClick} />
      </ul>
      <div className="system-xs-medium-uppercase mb-0.5 mt-3 px-3 pb-1 pt-2 text-text-tertiary">{t('newAppFromTemplate.byCategories', { ns: 'app' })}</div>
      <ul className="flex grow flex-col gap-0.5">
        {categories.map(category => (<CategoryItem key={category} category={category} active={current === category} onClick={onClick} />))}
      </ul>
      <Divider bgStyle="gradient" />
      <div className="flex cursor-pointer items-center gap-1 px-3 py-1 text-text-tertiary" onClick={onCreateFromBlank}>
        <RiStickyNoteAddLine className="h-3.5 w-3.5" />
        <span className="system-xs-regular">{t('newApp.startFromBlank', { ns: 'app' })}</span>
      </div>
    </div>
  )
}

type CategoryItemProps = {
  active: boolean
  category: AppCategories | string
  onClick?: (category: AppCategories | string) => void
}
function CategoryItem({ category, active, onClick }: CategoryItemProps) {
  return (
    <li
      className={cn('group flex h-8 cursor-pointer items-center gap-2 rounded-lg p-1 pl-3 hover:bg-state-base-hover [&.active]:bg-state-base-active', active && 'active')}
      onClick={() => { onClick?.(category) }}
    >
      {category === AppCategories.RECOMMENDED && (
        <div className="inline-flex h-5 w-5 items-center justify-center rounded-md">
          <RiThumbUpLine className="h-4 w-4 text-components-menu-item-text group-[.active]:text-components-menu-item-text-active" />
        </div>
      )}
      <AppCategoryLabel
        category={category}
        className={cn('system-sm-medium text-components-menu-item-text group-hover:text-components-menu-item-text-hover group-[.active]:text-components-menu-item-text-active', active && 'system-sm-semibold')}
      />
    </li>
  )
}

type AppCategoryLabelProps = {
  category: AppCategories | string
  className?: string
}
export function AppCategoryLabel({ category, className }: AppCategoryLabelProps) {
  const { t } = useTranslation()
  return <span className={className}>{category === AppCategories.RECOMMENDED ? t('newAppFromTemplate.sidebar.Recommended', { ns: 'app' }) : category}</span>
}
