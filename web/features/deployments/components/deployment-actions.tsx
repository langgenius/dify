'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeleteDeploymentDialog } from './delete-deployment-dialog'
import { EditDeploymentDialog } from './edit-deployment-dialog'

const ACTION_TRIGGER_CLASS_NAME = cn(
  'inline-flex size-8 items-center justify-center rounded-lg bg-components-panel-bg text-text-tertiary shadow-xs outline-hidden',
  'hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
)

export function DeploymentActionsMenu({
  appInstanceId,
  appName,
  className,
  triggerClassName,
}: {
  appInstanceId: string
  appName?: string
  className?: string
  triggerClassName?: string
}) {
  const { t } = useTranslation('deployments')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  function openEditDialog() {
    setMenuOpen(false)
    setEditOpen(true)
  }

  function openDeleteDialog() {
    setMenuOpen(false)
    setDeleteOpen(true)
  }

  return (
    <div
      className={className}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          aria-label={t('card.moreActions')}
          className={cn(ACTION_TRIGGER_CLASS_NAME, triggerClassName)}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        {menuOpen && (
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-44">
            <DropdownMenuItem className="gap-2 px-3" onClick={openEditDialog}>
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span className="system-sm-regular text-text-secondary">{t('card.menu.editInfo')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="gap-2 px-3"
              onClick={openDeleteDialog}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
              <span className="system-sm-regular">{t('card.menu.delete')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      <EditDeploymentDialog
        appInstanceId={appInstanceId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <DeleteDeploymentDialog
        appInstanceId={appInstanceId}
        appName={appName}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}
