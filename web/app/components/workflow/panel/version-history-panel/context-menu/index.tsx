import React, { type FC, useCallback } from 'react'
import { RiMoreFill } from '@remixicon/react'
import { VersionHistoryContextMenuOptions } from '../../../types'
import MenuItem from './menu-item'
import useContextMenu from './use-context-menu'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'

export type ContextMenuProps = {
  isShowDelete: boolean
  isNamedVersion: boolean
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  handleClickMenuItem: (operation: VersionHistoryContextMenuOptions) => void
}

const ContextMenu: FC<ContextMenuProps> = (props: ContextMenuProps) => {
  const { isShowDelete, handleClickMenuItem, open, setOpen } = props
  const {
    deleteOperation,
    options,
  } = useContextMenu(props)

  const handleClickTrigger = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setOpen(v => !v)
  }, [setOpen])

  return (
    <PortalToFollowElem
      placement={'bottom-end'}
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger>
        <Button size='small' className='px-1' onClick={handleClickTrigger}>
          <RiMoreFill className='h-4 w-4' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='flex w-[184px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'>
          <div className='flex flex-col p-1'>
            {
              options.map((option) => {
                return (
                  <MenuItem
                    key={option.key}
                    item={option}
                    onClick={handleClickMenuItem.bind(null, option.key)}
                  />
                )
              })
            }
          </div>
          {
            isShowDelete && (
              <>
                <Divider type='horizontal' className='my-0 h-px bg-divider-subtle' />
                <div className='p-1'>
                  <MenuItem
                    item={deleteOperation}
                    isDestructive
                    onClick={handleClickMenuItem.bind(null, VersionHistoryContextMenuOptions.delete)}
                  />
                </div>
              </>
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(ContextMenu)
