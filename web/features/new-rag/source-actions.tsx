'use client'

import type { SourceAction, SourceEditValues } from './source-list-model'
import type { Source } from './source-models'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SourceEditDialog } from './source-edit-dialog'
import { getOpenableSourceUri } from './source-list-model'

export function SourceActions({
  canEdit,
  canRemove,
  canSync,
  canToggle,
  onEdit,
  onRemove,
  onSync,
  onToggle,
  pendingAction,
  source,
  syncAction,
}: {
  canEdit: boolean
  canRemove: boolean
  canSync: boolean
  canToggle: boolean
  onEdit: (values: SourceEditValues) => Promise<boolean>
  onRemove: () => Promise<boolean>
  onSync: () => Promise<boolean>
  onToggle: () => Promise<boolean>
  pendingAction?: SourceAction
  source: Source
  syncAction: 'retry' | 'sync'
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const sourceUri = getOpenableSourceUri(source.uri)

  const openEditDialog = () => {
    setMenuOpen(false)
    setEditDialogOpen(true)
  }

  if (!canEdit && !canRemove && !canSync && !canToggle && !sourceUri) return null

  return (
    <>
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          aria-label={t(($) => $['newKnowledge.sourceActions'], { name: source.name })}
          disabled={Boolean(pendingAction)}
          className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
        >
          <span
            aria-hidden
            className={cn(
              'size-4.5',
              pendingAction ? 'i-ri-loader-4-line animate-spin' : 'i-ri-more-fill',
            )}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-[200px]">
          {canSync && (
            <DropdownMenuItem
              onClick={() => void onSync()}
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-refresh-line size-4" />
              {syncAction === 'retry'
                ? tCommon(($) => $['operation.retry'])
                : t(($) => $['newKnowledge.syncNow'])}
            </DropdownMenuItem>
          )}
          {sourceUri && (
            <DropdownMenuLinkItem
              render={
                <a
                  aria-label={t(($) => $['newKnowledge.openSource'])}
                  href={sourceUri}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-external-link-line size-4" />
              {t(($) => $['newKnowledge.openSource'])}
            </DropdownMenuLinkItem>
          )}
          {canEdit && (
            <DropdownMenuItem
              onClick={openEditDialog}
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-edit-line size-4" />
              {tCommon(($) => $['operation.edit'])}
            </DropdownMenuItem>
          )}
          {canToggle && (
            <DropdownMenuItem
              onClick={() => void onToggle()}
              className="h-7 gap-2 px-2 system-sm-medium"
            >
              <span
                aria-hidden
                className={cn(
                  'size-4',
                  source.status === 'disabled'
                    ? 'i-ri-checkbox-circle-line'
                    : 'i-ri-indeterminate-circle-line',
                )}
              />
              {source.status === 'disabled'
                ? t(($) => $.enable)
                : t(($) => $['newKnowledge.disableSource'])}
            </DropdownMenuItem>
          )}
          {canRemove && (
            <>
              {(canEdit || canSync || canToggle || sourceUri) && (
                <DropdownMenuSeparator className="my-px" />
              )}
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false)
                  setRemoveDialogOpen(true)
                }}
                variant="destructive"
                className="h-7 gap-2 px-2 system-sm-medium"
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                {t(($) => $['newKnowledge.removeSource'])}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SourceEditDialog
        onEdit={onEdit}
        onOpenChange={setEditDialogOpen}
        open={editDialogOpen}
        pending={pendingAction === 'edit'}
        source={source}
      />
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.deleteConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {tCommon(($) => $['operation.confirmAction'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              loading={pendingAction === 'remove'}
              onClick={() =>
                void onRemove().then((removed) => {
                  if (removed) setRemoveDialogOpen(false)
                })
              }
            >
              {t(($) => $['newKnowledge.removeSource'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
