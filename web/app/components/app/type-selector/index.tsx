import { useTranslation } from 'react-i18next'
import React, { useState } from 'react'
import { RiArrowDownSLine, RiCloseCircleFill, RiExchange2Fill, RiFilter3Line } from '@remixicon/react'
import Checkbox from '../../base/checkbox'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { BubbleTextMod, ChatBot, ListSparkle, Logic } from '@/app/components/base/icons/src/vender/solid/communication'
import { type AppMode } from '@/types/app'
export type AppSelectorProps = {
  value: Array<AppMode>
  onChange: (value: AppSelectorProps['value']) => void
}

const allTypes: AppMode[] = ['chat', 'agent-chat', 'completion', 'advanced-chat', 'workflow']

const AppTypeSelector = ({ value, onChange }: AppSelectorProps) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className='block'
        >
          <div className={cn(
            'flex items-center justify-between rounded-md cursor-pointer px-2 space-x-1 hover:bg-state-base-hover',
          )}>
            <AppTypeSelectTrigger values={value} />
            {value && value.length > 0 && <div className='w-4 h-4' onClick={(e) => {
              e.stopPropagation()
              onChange([])
            }}>
              <RiCloseCircleFill className='w-3.5 h-3.5 text-text-quaternary hover:text-text-tertiary cursor-pointer' />
            </div>}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <ul className='relative p-1 w-[240px] bg-components-panel-bg-blur backdrop-blur-[5px] rounded-xl shadow-lg border border-components-panel-border'>
            {allTypes.map(mode => (
              <AppTypeSelectorItem key={mode} type={mode}
                checked={Boolean(value.length > 0 && value?.indexOf(mode) !== -1)}
                onClick={() => {
                  if (value?.indexOf(mode) !== -1)
                    onChange(value?.filter(v => v !== mode) ?? [])
                  else
                    onChange([...(value || []), mode])
                }} />
            ))}
          </ul>
        </PortalToFollowElemContent>
      </div >
    </PortalToFollowElem >
  )
}

export default AppTypeSelector

function AppTypeSelectTrigger({ values }: { values: AppSelectorProps['value'] }) {
  const { t } = useTranslation()
  if (!values || values.length === 0) {
    return <div className={cn(
      'flex items-center justify-between gap-1 h-8',
    )}>
      <RiFilter3Line className='w-4 h-4 text-text-tertiary' />
      <div className='grow min-w-[65px] text-center system-sm-medium text-text-tertiary'>{t('app.typeSelector.all')}</div>
      <RiArrowDownSLine className='w-4 h-4 text-text-tertiary' />
    </div>
  }
  if (values.length === 1) {
    return <div className={cn(
      'flex items-center justify-between gap-1 h-8 flex-nowrap',
    )}>
      <AppTypeIcon type={values[0]} />
      <div className='flex flex-1 items-center text-center line-clamp-1'>
        <AppTypeLabel type={values[0]} className="system-sm-medium text-components-menu-item-text" />
      </div>
    </div>
  }
  return <div className={cn(
    'flex items-center justify-between h-8 -space-x-2 relative',
  )}>
    {values.map((mode, index) => (<AppTypeIcon key={mode} type={mode} wrapperClassName='border border-components-panel-on-panel-item-bg' style={{ zIndex: 5 - index }} />))}
  </div>
}

type AppTypeSelectorItemProps = {
  checked: boolean
  type: AppMode
  onClick: () => void
}
function AppTypeSelectorItem({ checked, type, onClick }: AppTypeSelectorItemProps) {
  return <li className='flex items-center space-x-2 pl-2 py-1 pr-1 rounded-lg cursor-pointer hover:bg-state-base-hover' onClick={onClick}>
    <Checkbox checked={checked} />
    <AppTypeIcon type={type} />
    <div className='grow p-1 pl-0'>
      <AppTypeLabel type={type} className="system-sm-medium text-components-menu-item-text" />
    </div>
  </li>
}

type AppTypeIconProps = {
  type: AppMode
  style?: React.CSSProperties
  className?: string
  wrapperClassName?: string
}

export function AppTypeIcon({ type, className, wrapperClassName, style }: AppTypeIconProps) {
  const wrapperClassNames = cn('w-5 h-5 inline-flex items-center justify-center rounded-md border border-divider-regular', wrapperClassName)
  const iconClassNames = cn('w-3.5 h-3.5 text-components-avatar-shape-fill-stop-100', className)
  if (type === 'chat') {
    return <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-blue-solid')}>
      <ChatBot className={iconClassNames} />
    </div>
  }
  if (type === 'agent-chat') {
    return <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-violet-solid')}>
      <Logic className={iconClassNames} />
    </div>
  }
  if (type === 'advanced-chat') {
    return <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-blue-light-solid')}>
      <BubbleTextMod className={iconClassNames} />
    </div>
  }
  if (type === 'workflow') {
    return <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-indigo-solid')}>
      <RiExchange2Fill className={iconClassNames} />
    </div>
  }
  if (type === 'completion') {
    return <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-teal-solid')}>
      <ListSparkle className={iconClassNames} />
    </div>
  }
  return null
}

type AppTypeLabelProps = {
  type: AppMode
  className?: string
}
export function AppTypeLabel({ type, className }: AppTypeLabelProps) {
  const { t } = useTranslation()
  let label = ''
  if (type === 'chat')
    label = t('app.typeSelector.chatbot')
  if (type === 'agent-chat')
    label = t('app.typeSelector.agent')
  if (type === 'completion')
    label = t('app.typeSelector.completion')
  if (type === 'advanced-chat')
    label = t('app.typeSelector.advanced')
  if (type === 'workflow')
    label = t('app.typeSelector.workflow')

  return <span className={className}>{label}</span>
}
