import { RiArrowDownSLine, RiCloseCircleFill, RiExchange2Fill, RiFilter3Line } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BubbleTextMod, ChatBot, ListSparkle, Logic } from '@/app/components/base/icons/src/vender/solid/communication'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'
import Checkbox from '../../base/checkbox'

export type AppSelectorProps = {
  value: Array<AppModeEnum>
  onChange: (value: AppSelectorProps['value']) => void
}

const allTypes: AppModeEnum[] = [AppModeEnum.WORKFLOW, AppModeEnum.ADVANCED_CHAT, AppModeEnum.CHAT, AppModeEnum.AGENT_CHAT, AppModeEnum.COMPLETION]

const AppTypeSelector = ({ value, onChange }: AppSelectorProps) => {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={4}
    >
      <div className="relative">
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className="block"
        >
          <div className={cn(
            'flex cursor-pointer items-center justify-between space-x-1 rounded-md px-2 hover:bg-state-base-hover',
          )}
          >
            <AppTypeSelectTrigger values={value} />
            {value && value.length > 0 && (
              <button
                type="button"
                aria-label={t('operation.clear', { ns: 'common' })}
                className="group h-4 w-4"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange([])
                }}
              >
                <RiCloseCircleFill
                  className="h-3.5 w-3.5 text-text-quaternary group-hover:text-text-tertiary"
                />
              </button>
            )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[1002]">
          <ul className="relative w-[240px] rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
            {allTypes.map(mode => (
              <AppTypeSelectorItem
                key={mode}
                type={mode}
                checked={Boolean(value.length > 0 && value?.indexOf(mode) !== -1)}
                onClick={() => {
                  if (value?.indexOf(mode) !== -1)
                    onChange(value?.filter(v => v !== mode) ?? [])
                  else
                    onChange([...(value || []), mode])
                }}
              />
            ))}
          </ul>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default AppTypeSelector

type AppTypeIconProps = {
  type: AppModeEnum
  style?: React.CSSProperties
  className?: string
  wrapperClassName?: string
}

export const AppTypeIcon = React.memo(({ type, className, wrapperClassName, style }: AppTypeIconProps) => {
  const wrapperClassNames = cn('inline-flex h-5 w-5 items-center justify-center rounded-md border border-divider-regular', wrapperClassName)
  const iconClassNames = cn('h-3.5 w-3.5 text-components-avatar-shape-fill-stop-100', className)
  if (type === AppModeEnum.CHAT) {
    return (
      <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-blue-solid')}>
        <ChatBot className={iconClassNames} />
      </div>
    )
  }
  if (type === AppModeEnum.AGENT_CHAT) {
    return (
      <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-violet-solid')}>
        <Logic className={iconClassNames} />
      </div>
    )
  }
  if (type === AppModeEnum.ADVANCED_CHAT) {
    return (
      <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-blue-light-solid')}>
        <BubbleTextMod className={iconClassNames} />
      </div>
    )
  }
  if (type === AppModeEnum.WORKFLOW) {
    return (
      <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-indigo-solid')}>
        <RiExchange2Fill className={iconClassNames} />
      </div>
    )
  }
  if (type === AppModeEnum.COMPLETION) {
    return (
      <div style={style} className={cn(wrapperClassNames, 'bg-components-icon-bg-teal-solid')}>
        <ListSparkle className={iconClassNames} />
      </div>
    )
  }
  return null
})

function AppTypeSelectTrigger({ values }: { readonly values: AppSelectorProps['value'] }) {
  const { t } = useTranslation()
  if (!values || values.length === 0) {
    return (
      <div className={cn(
        'flex h-8 items-center justify-between gap-1',
      )}
      >
        <RiFilter3Line className="h-4 w-4 text-text-tertiary" />
        <div className="system-sm-medium min-w-[65px] grow text-center text-text-tertiary">{t('typeSelector.all', { ns: 'app' })}</div>
        <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
      </div>
    )
  }
  if (values.length === 1) {
    return (
      <div className={cn(
        'flex h-8 flex-nowrap items-center justify-between gap-1',
      )}
      >
        <AppTypeIcon type={values[0]} />
        <div className="line-clamp-1 flex flex-1 items-center text-center">
          <AppTypeLabel type={values[0]} className="system-sm-medium text-components-menu-item-text" />
        </div>
      </div>
    )
  }
  return (
    <div className={cn(
      'relative flex h-8 items-center justify-between -space-x-2',
    )}
    >
      {values.map((mode, index) => (<AppTypeIcon key={mode} type={mode} wrapperClassName="border border-components-panel-on-panel-item-bg" style={{ zIndex: 5 - index }} />))}
    </div>
  )
}

type AppTypeSelectorItemProps = {
  checked: boolean
  type: AppModeEnum
  onClick: () => void
}
function AppTypeSelectorItem({ checked, type, onClick }: AppTypeSelectorItemProps) {
  return (
    <li className="flex cursor-pointer items-center space-x-2 rounded-lg py-1 pl-2 pr-1 hover:bg-state-base-hover" onClick={onClick}>
      <Checkbox checked={checked} />
      <AppTypeIcon type={type} />
      <div className="grow p-1 pl-0">
        <AppTypeLabel type={type} className="system-sm-medium text-components-menu-item-text" />
      </div>
    </li>
  )
}

type AppTypeLabelProps = {
  type: AppModeEnum
  className?: string
}
export function AppTypeLabel({ type, className }: AppTypeLabelProps) {
  const { t } = useTranslation()
  let label = ''
  if (type === AppModeEnum.CHAT)
    label = t('typeSelector.chatbot', { ns: 'app' })
  if (type === AppModeEnum.AGENT_CHAT)
    label = t('typeSelector.agent', { ns: 'app' })
  if (type === AppModeEnum.COMPLETION)
    label = t('typeSelector.completion', { ns: 'app' })
  if (type === AppModeEnum.ADVANCED_CHAT)
    label = t('typeSelector.advanced', { ns: 'app' })
  if (type === AppModeEnum.WORKFLOW)
    label = t('typeSelector.workflow', { ns: 'app' })

  return <span className={className}>{label}</span>
}
