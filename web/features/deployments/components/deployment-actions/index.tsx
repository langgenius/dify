'use client'

import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import { DeleteDeploymentDialog } from './delete-dialog'
import { EditDeploymentDialog } from './edit-dialog'
import {
  deploymentActionAppInstanceIdAtom,
  deploymentActionAppInstanceQueryOptionsAtom,
  deploymentActionsLocalAtoms,
  openDeleteDeploymentDialogAtom,
  openEditDeploymentDialogAtom,
} from './state'

const ACTION_TRIGGER_CLASS_NAME = cn(
  'inline-flex size-8 items-center justify-center rounded-lg bg-components-panel-bg text-text-tertiary shadow-xs outline-hidden',
  'hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
)

type DeploymentActionsMenuProps = {
  appInstanceId: string
  className?: string
  triggerClassName?: string
  placement: ComponentProps<typeof DropdownMenuContent>['placement']
  sideOffset?: ComponentProps<typeof DropdownMenuContent>['sideOffset']
}

function DeploymentActionsMenuContent({
  className,
  triggerClassName,
  placement,
  sideOffset,
}: Omit<DeploymentActionsMenuProps, 'appInstanceId'>) {
  const { t } = useTranslation('deployments')
  const queryClient = useQueryClient()
  const appInstanceQueryOptions = useAtomValue(deploymentActionAppInstanceQueryOptionsAtom)
  const openEditDialog = useSetAtom(openEditDeploymentDialogAtom)
  const openDeleteDialog = useSetAtom(openDeleteDeploymentDialogAtom)

  function handleMenuOpenChange(open: boolean) {
    if (open)
      void queryClient.prefetchQuery(appInstanceQueryOptions)
  }

  return (
    <div
      role="presentation"
      className={cn(
        className,
        '[&:has([data-popup-open])]:pointer-events-auto [&:has([data-popup-open])]:opacity-100',
      )}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <DropdownMenu modal={false} onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger
          aria-label={t('card.moreActions')}
          className={cn(ACTION_TRIGGER_CLASS_NAME, triggerClassName)}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement={placement} sideOffset={sideOffset} popupClassName="min-w-44">
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
      </DropdownMenu>
      <EditDeploymentDialog />
      <DeleteDeploymentDialog />
    </div>
  )
}

export function DeploymentActionsMenu({
  appInstanceId,
  ...props
}: DeploymentActionsMenuProps) {
  return (
    <ScopeProvider
      key={appInstanceId}
      atoms={[
        [deploymentActionAppInstanceIdAtom, appInstanceId],
        ...deploymentActionsLocalAtoms,
      ]}
      name="DeploymentActionsMenu"
    >
      <DeploymentActionsMenuContent {...props} />
    </ScopeProvider>
  )
}
