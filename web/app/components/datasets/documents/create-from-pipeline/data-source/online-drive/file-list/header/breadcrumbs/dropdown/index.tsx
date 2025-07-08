import React, { useCallback, useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { RiMoreFill } from '@remixicon/react'
import cn from '@/utils/classnames'
import Menu from './menu'

type DropdownProps = {
  startIndex: number
  breadcrumbs: string[]
  onBreadcrumbClick: (index: number) => void
}

const Dropdown = ({
  startIndex,
  breadcrumbs,
  onBreadcrumbClick,
}: DropdownProps) => {
  const [open, setOpen] = useState(false)

  const handleTrigger = useCallback(() => {
    setOpen(prev => !prev)
  }, [])

  const handleBreadCrumbClick = useCallback((index: number) => {
    onBreadcrumbClick(index)
    setOpen(false)
  }, [onBreadcrumbClick])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{
        mainAxis: 4,
        crossAxis: -13,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <button
          type='button'
          className={cn(
            'flex size-6 items-center justify-center rounded-md',
            open ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
          )}
        >
          <RiMoreFill className='size-4 text-text-tertiary' />
        </button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <Menu
          breadcrumbs={breadcrumbs}
          startIndex={startIndex}
          onBreadcrumbClick={handleBreadCrumbClick}
        />
      </PortalToFollowElemContent>
      <span className='system-xs-regular text-divider-deep'>/</span>
    </PortalToFollowElem>
  )
}

export default React.memo(Dropdown)
