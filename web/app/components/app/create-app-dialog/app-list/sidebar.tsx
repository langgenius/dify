'use client'
import { RiAppsFill, RiChatSmileAiFill, RiExchange2Fill, RiPassPendingFill, RiQuillPenAiFill, RiSpeakAiFill, RiStickyNoteAddLine, RiTerminalBoxFill, RiThumbUpFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import classNames from '@/utils/classnames'
import Divider from '@/app/components/base/divider'

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
  onCreateFromBlank?: () => void
}

export default function Sidebar({ current, onClick, onCreateFromBlank }: SidebarProps) {
  const { t } = useTranslation()
  return <div className="w-full h-full flex flex-col">
    <ul>
      <CategoryItem category={AppCategories.RECOMMENDED} active={current === AppCategories.RECOMMENDED} onClick={onClick} />
    </ul>
    <div className='px-3 pt-2 pb-1 system-xs-medium-uppercase text-text-tertiary'>{t('app.newAppFromTemplate.byCategories')}</div>
    <ul className='flex-grow flex flex-col gap-0.5'>
      <CategoryItem category={AppCategories.ASSISTANT} active={current === AppCategories.ASSISTANT} onClick={onClick} />
      <CategoryItem category={AppCategories.AGENT} active={current === AppCategories.AGENT} onClick={onClick} />
      <CategoryItem category={AppCategories.HR} active={current === AppCategories.HR} onClick={onClick} />
      <CategoryItem category={AppCategories.PROGRAMMING} active={current === AppCategories.PROGRAMMING} onClick={onClick} />
      <CategoryItem category={AppCategories.WORKFLOW} active={current === AppCategories.WORKFLOW} onClick={onClick} />
      <CategoryItem category={AppCategories.WRITING} active={current === AppCategories.WRITING} onClick={onClick} />
    </ul>
    <Divider bgStyle='gradient' />
    <div className='px-3 py-1 flex items-center gap-1 text-text-tertiary cursor-pointer' onClick={onCreateFromBlank}>
      <RiStickyNoteAddLine className='w-3.5 h-3.5' />
      <span className='system-xs-regular'>{t('app.newApp.startFromBlank')}</span>
    </div>
  </div>
}

type CategoryItemProps = {
  active: boolean
  category: AppCategories
  onClick?: (category: AppCategories) => void
}
function CategoryItem({ category, active, onClick }: CategoryItemProps) {
  return <li
    className={classNames('p-1 pl-3 rounded-lg flex items-center gap-2 group cursor-pointer hover:bg-state-base-hover [&.active]:bg-state-base-active', active && 'active')}
    onClick={() => { onClick?.(category) }}>
    <div className='w-5 h-5 inline-flex items-center justify-center rounded-md border border-divider-regular bg-components-icon-bg-midnight-solid group-[.active]:bg-components-icon-bg-blue-solid'>
      <AppCategoryIcon category={category} />
    </div>
    <AppCategoryLabel category={category}
      className={classNames('system-sm-medium text-components-menu-item-text group-[.active]:text-components-menu-item-text-active group-hover:text-components-menu-item-text-hover', active && 'system-sm-semibold')} />
  </li >
}

type AppCategoryLabelProps = {
  category: AppCategories
  className?: string
}
export function AppCategoryLabel({ category, className }: AppCategoryLabelProps) {
  const { t } = useTranslation()
  return <span className={className}>{t(`app.newAppFromTemplate.sidebar.${category}`)}</span>
}

type AppCategoryIconProps = {
  category: AppCategories
}
function AppCategoryIcon({ category }: AppCategoryIconProps) {
  if (category === AppCategories.AGENT)
    return <RiSpeakAiFill className='w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.ASSISTANT)
    return <RiChatSmileAiFill className='w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.HR)
    return <RiPassPendingFill className='w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.PROGRAMMING)
    return <RiTerminalBoxFill className='w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.RECOMMENDED)
    return <RiThumbUpFill className='w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.WRITING)
    return <RiQuillPenAiFill className='w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100' />
  if (category === AppCategories.WORKFLOW)
    return <RiExchange2Fill className='w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100' />
  return <RiAppsFill className='w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100' />
}
