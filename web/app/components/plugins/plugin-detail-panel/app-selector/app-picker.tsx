'use client'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import Input from '@/app/components/base/input'
import AppIcon from '@/app/components/base/app-icon'
import {
  useAppFullList,
} from '@/service/use-apps'
import type { App } from '@/types/app'

type Props = {
  disabled: boolean
  trigger: React.ReactNode
  placement?: Placement
  offset?: OffsetOptions
  isShow: boolean
  onShowChange: (isShow: boolean) => void
  onSelect: (app: App) => void
}

const AppPicker: FC<Props> = ({
  disabled,
  trigger,
  placement = 'right-start',
  offset = 0,
  isShow,
  onShowChange,
  onSelect,
}) => {
  const [searchText, setSearchText] = useState('')
  const { data: appList } = useAppFullList()
  const filteredAppList = useMemo(() => {
    return (appList || []).filter(app => app.name.toLowerCase().includes(searchText.toLowerCase()))
  }, [appList, searchText])
  const getAppType = (app: App) => {
    switch (app.mode) {
      case 'advanced-chat':
        return 'chatflow'
      case 'agent-chat':
        return 'agent'
      case 'chat':
        return 'chat'
      case 'completion':
        return 'completion'
      case 'workflow':
        return 'workflow'
    }
  }

  const handleTriggerClick = () => {
    if (disabled) return
    onShowChange(true)
  }

  return (
    <PortalToFollowElem
      placement={placement}
      offset={offset}
      open={isShow}
      onOpenChange={onShowChange}
    >
      <PortalToFollowElemTrigger
        onClick={handleTriggerClick}
      >
        {trigger}
      </PortalToFollowElemTrigger>

      <PortalToFollowElemContent className='z-[1000]'>
        <div className="relative w-[356px] min-h-20 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border shadow-lg">
          <div className='p-2 pb-1'>
            <Input
              showLeftIcon
              showClearIcon
              // wrapperClassName='w-[200px]'
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onClear={() => setSearchText('')}
            />
          </div>
          <div className='p-1'>
            {filteredAppList.map(app => (
              <div
                key={app.id}
                className='flex items-center gap-3 py-1 pl-2 pr-3 rounded-lg hover:bg-state-base-hover cursor-pointer'
                onClick={() => onSelect(app)}
              >
                <AppIcon
                  className='shrink-0'
                  size='xs'
                  iconType={app.icon_type}
                  icon={app.icon}
                  background={app.icon_background}
                  imageUrl={app.icon_url}
                />
                <div title={app.name} className='grow system-sm-medium text-components-input-text-filled'>{app.name}</div>
                <div className='shrink-0 text-text-tertiary system-2xs-medium-uppercase'>{getAppType(app)}</div>
              </div>
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(AppPicker)
