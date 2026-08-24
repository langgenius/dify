import type { FC } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { VersionHistoryContextMenuOptions } from '../../../types'
import ActionMenuItem from './action-menu-item'
import useActionMenu from './use-action-menu'

export type ActionMenuProps = {
  workflowId: string
  isShowDelete: boolean
  isNamedVersion: boolean
  canImportExportDSL: boolean
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  handleClickActionMenuItem: (operation: VersionHistoryContextMenuOptions) => void
}

const ActionMenu: FC<ActionMenuProps> = (props: ActionMenuProps) => {
  const { isShowDelete, handleClickActionMenuItem, open, setOpen } = props
  const { deleteOperation, options } = useActionMenu(props)
  const { t } = useTranslation()

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <IconButton
            size="md"
            variant="secondary"
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            onClick={(e) => e.stopPropagation()}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        className="w-max max-w-[calc(100vw-24px)] min-w-[184px] shadow-shadow-shadow-5"
      >
        {options.map((option) => (
          <ActionMenuItem
            key={option.key}
            item={option}
            onClick={handleClickActionMenuItem.bind(null, option.key)}
          />
        ))}
        {isShowDelete && (
          <>
            <DropdownMenuSeparator className="my-1" />
            <ActionMenuItem
              item={deleteOperation}
              isDestructive
              onClick={handleClickActionMenuItem.bind(
                null,
                VersionHistoryContextMenuOptions.delete,
              )}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default React.memo(ActionMenu)
