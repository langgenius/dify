import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiMoreFill } from '@remixicon/react'
import * as React from 'react'
import { VersionHistoryContextMenuOptions } from '../../../types'
import ActionMenuItem from './action-menu-item'
import useActionMenu from './use-action-menu'

export type ActionMenuProps = {
  isShowDelete: boolean
  isNamedVersion: boolean
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  handleClickActionMenuItem: (operation: VersionHistoryContextMenuOptions) => void
}

const ActionMenu: FC<ActionMenuProps> = (props: ActionMenuProps) => {
  const { isShowDelete, handleClickActionMenuItem, open, setOpen } = props
  const {
    deleteOperation,
    options,
  } = useActionMenu(props)

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
            <ActionMenuItem
              key={option.key}
              item={option}
              onClick={handleClickActionMenuItem.bind(null, option.key)}
            />
          ))
        }
        {
          isShowDelete && (
            <>
              <DropdownMenuSeparator className="my-0" />
              <ActionMenuItem
                item={deleteOperation}
                isDestructive
                onClick={handleClickActionMenuItem.bind(null, VersionHistoryContextMenuOptions.delete)}
              />
            </>
          )
        }
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default React.memo(ActionMenu)
