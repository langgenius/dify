'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  inCard?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit: () => void
  onRemove: () => void
}>

const OperationMenu: FC<Props> = ({ inCard, onOpenChange, onEdit, onRemove }) => {
  const { t } = useTranslation(['common', 'tools'])

  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger
        render={
          <IconButton
            size={inCard ? 'lg' : 'md'}
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            className="data-popup-open:bg-state-base-hover"
          >
            <span aria-hidden className={cn('i-ri-more-fill size-4', inCard && 'size-5')} />
          </IconButton>
        }
      />
      <MenuContent align="end" className="w-40">
        <MenuItem onClick={onEdit}>
          <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
          <div className="ms-2 system-md-regular text-text-secondary">
            {t(($) => $['mcp.operation.edit'], { ns: 'tools' })}
          </div>
        </MenuItem>
        <MenuItem
          className="data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive"
          onClick={onRemove}
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0 text-inherit" />
          <div className="ms-2 system-md-regular text-inherit">
            {t(($) => $['mcp.operation.remove'], { ns: 'tools' })}
          </div>
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
export default React.memo(OperationMenu)
