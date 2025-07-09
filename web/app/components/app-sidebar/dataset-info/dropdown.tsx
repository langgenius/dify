import React, { useCallback, useState } from 'react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../base/portal-to-follow-elem'
import ActionButton from '../../base/action-button'
import { RiMoreFill } from '@remixicon/react'
import cn from '@/utils/classnames'
import Menu from './menu'

type DropDownProps = {
  expand: boolean
}

const DropDown = ({
  expand,
}: DropDownProps) => {
  const [open, setOpen] = useState(false)

  const handleTrigger = useCallback(() => {
    setOpen(prev => !prev)
  }, [])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement={expand ? 'bottom-end' : 'right'}
      offset={expand ? {
        mainAxis: 4,
        crossAxis: 10,
      } : {
        mainAxis: 4,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <ActionButton className={cn(expand ? 'size-8 rounded-lg' : 'size-6 rounded-md')}>
          <RiMoreFill className='size-4' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <Menu />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(DropDown)
