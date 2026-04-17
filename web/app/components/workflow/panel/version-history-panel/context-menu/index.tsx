import type { FC } from 'react'
import { RiMoreFill } from '@remixicon/react'
import * as React from 'react'
import { Button } from '@/app/components/base/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { VersionHistoryContextMenuOptions } from '../../../types'
import MenuItem from './menu-item'
import useContextMenu from './use-context-menu'

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

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        render={<Button size="small" className="px-1" onClick={e => e.stopPropagation()} />}
      >
        <RiMoreFill className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-[184px] shadow-shadow-shadow-5"
      >
        {
          options.map(option => (
            <MenuItem
              key={option.key}
              item={option}
              onClick={handleClickMenuItem.bind(null, option.key)}
            />
          ))
        }
        {
          isShowDelete && (
            <>
              <DropdownMenuSeparator className="my-0" />
              <MenuItem
                item={deleteOperation}
                isDestructive
                onClick={handleClickMenuItem.bind(null, VersionHistoryContextMenuOptions.delete)}
              />
            </>
          )
        }
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default React.memo(ContextMenu)
