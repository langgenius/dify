'use client'
import { RiAppsFill, RiExchange2Fill, RiPassPendingFill, RiQuillPenAiFill, RiTerminalBoxFill, RiThumbUpFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import classNames from '@/utils/classnames'

export enum AppCategories {
  RECOMMENDED = 'Recommended',
  ASSISTANT = 'Assistant',
  AGENT = 'Agent',
  HR = 'HR',
  PROGRAMMING = 'Programming',
  WORKFLOW = 'Workflow',
  WRITING = 'Writing',
}

type SidebarProps = {
  current: AppCategories
  onClick?: (category: AppCategories) => void
}

export default function Sidebar({ current, onClick }: SidebarProps) {
  const { t } = useTranslation()
  return <div className="w-full h-full">
    <ul>
      <CategoryItem category={AppCategories.RECOMMENDED} active={current === AppCategories.RECOMMENDED} onClick={onClick} />
    </ul>
    <div className='px-3 pt-2 pb-1 system-xs-medium-uppercase text-text-tertiary'>{t('app.newAppFromTemplate.byCategories')}</div>
    <ul className='flex flex-col gap-1'>
      <CategoryItem category={AppCategories.ASSISTANT} active={current === AppCategories.ASSISTANT} onClick={onClick} />
      <CategoryItem category={AppCategories.AGENT} active={current === AppCategories.AGENT} onClick={onClick} />
      <CategoryItem category={AppCategories.HR} active={current === AppCategories.HR} onClick={onClick} />
      <CategoryItem category={AppCategories.PROGRAMMING} active={current === AppCategories.PROGRAMMING} onClick={onClick} />
      <CategoryItem category={AppCategories.WORKFLOW} active={current === AppCategories.WORKFLOW} onClick={onClick} />
      <CategoryItem category={AppCategories.WRITING} active={current === AppCategories.WRITING} onClick={onClick} />
    </ul>
  </div>
}

type CategoryItemProps = {
  active: boolean
  category: AppCategories
  onClick?: (category: AppCategories) => void
}
function CategoryItem({ category, active, onClick }: CategoryItemProps) {
  const { t } = useTranslation()
  return <li className='p-1 pl-3 rounded-lg flex items-center gap-2 group cursor-pointer
focus:bg-state-base-active active:bg-state-base-active hover:bg-state-base-hover
' onClick={() => { onClick?.(category) }}>
    <div className={classNames('p-1 rounded-md border border-divider-regular bg-components-icon-bg-midnight-solid',
      active ? 'bg-components-icon-bg-blue-solid' : '')}>
      <AppCategoryIcon category={category} />
    </div>
    <span className='system-sm-semibold
  group-focus:text-components-menu-item-text-active
  group-active:text-components-menu-item-text-active
  group-hover:text-components-menu-item-text-hover'>{t(`app.newAppFromTemplate.sidebar.${category}`)}</span>
  </li >
}

type AppCategoryIconProps = {
  category: AppCategories
}
function AppCategoryIcon({ category }: AppCategoryIconProps) {
  if (category === AppCategories.AGENT)
    return <RiAppsFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.ASSISTANT)
    return <RiAppsFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.HR)
    return <RiPassPendingFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.PROGRAMMING)
    return <RiTerminalBoxFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.RECOMMENDED)
    return <RiThumbUpFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.WRITING)
    return <RiQuillPenAiFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.WORKFLOW)
    return <RiExchange2Fill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  return <RiAppsFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
}
