import React from 'react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { useBoolean } from 'ahooks'
import cn from '@/utils/classnames'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'

type Option = {
  label: string
  value: number
}

type VersionSelectorProps = {
  versionLen: number;
  value: number;
  onChange: (index: number) => void;
}

const VersionSelector: React.FC<VersionSelectorProps> = ({ versionLen, value, onChange }) => {
  const [isOpen, {
    setFalse: handleOpenFalse,
    toggle: handleOpenToggle,
    set: handleOpenSet,
  }] = useBoolean(false)

  const versions = Array.from({ length: versionLen }, (_, index) => ({
    label: `Version ${index + 1}${index === versionLen - 1 ? ' · Latest' : ''}`,
    value: index,
  }))

  const isLatest = value === versionLen - 1

  return (
    <PortalToFollowElem
      placement={'bottom-start'}
      offset={{
        mainAxis: 4,
        crossAxis: -8,
      }}
      open={isOpen}
      onOpenChange={handleOpenSet}
    >
      <PortalToFollowElemTrigger
        onClick={handleOpenToggle}
        asChild
      >

        <div className='system-xs-medium flex cursor-pointer items-center text-text-secondary'>
          <div>Version {value + 1}{isLatest && ' · Latest'}</div>
          <RiArrowDownSLine className='size-3 ' />
        </div>
      </PortalToFollowElemTrigger >
      <PortalToFollowElemContent className={cn(
        'z-[99]',
      )}>
        <div
          className={cn(
            'w-[208px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg',
          )}
        >
          <div className='system-xs-medium-uppercase flex h-[22px] items-center px-3 pl-3 text-text-tertiary'>
            Versions
          </div>
          {
            versions.map(option => (
              <div
                key={option.value}
                className={cn(
                  'system-sm-medium flex h-7 cursor-pointer items-center rounded-lg px-2 text-text-secondary hover:bg-state-base-hover',
                )}
                title={option.label}
                onClick={() => {
                  onChange(option.value)
                  handleOpenFalse()
                }}
              >
                <div className='mr-1 grow truncate px-1 pl-1'>
                  {option.label}
                </div>
                {
                  value === option.value && <RiCheckLine className='h-4 w-4 shrink-0 text-text-accent' />
                }
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem >
  )
}

export default VersionSelector
