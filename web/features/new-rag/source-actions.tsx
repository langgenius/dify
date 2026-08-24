'use client'

import type { SourceAction, SourceEditValues } from './source-list-model'
import type { Source, SourceSyncPolicy } from './source-models'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Input } from '@langgenius/dify-ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH } from './routes'
import {
  getOpenableSourceUri,
  sourceCustomIntervalHours,
  sourceSyncMode,
  sourceSyncPolicyChanged,
} from './source-list-model'
import { SyncPolicyField } from './sync-policy-field'

const MIN_CUSTOM_INTERVAL_HOURS = 1
const MAX_CUSTOM_INTERVAL_HOURS = 720

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
  const [nextName, setNextName] = useState(source.name)
  const [nextSyncMode, setNextSyncMode] = useState<SourceSyncPolicy['mode']>(() =>
    sourceSyncMode(source),
  )
  const [nextCustomIntervalHours, setNextCustomIntervalHours] = useState<number | ''>(() =>
    sourceCustomIntervalHours(source),
  )
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const sourceUri = getOpenableSourceUri(source.uri)
  const customIntervalValid =
    typeof nextCustomIntervalHours === 'number' &&
    Number.isInteger(nextCustomIntervalHours) &&
    nextCustomIntervalHours >= MIN_CUSTOM_INTERVAL_HOURS &&
    nextCustomIntervalHours <= MAX_CUSTOM_INTERVAL_HOURS
  const nameChanged = nextName.trim() !== source.name
  const syncPolicyChanged =
    customIntervalValid &&
    sourceSyncPolicyChanged(source, nextSyncMode, nextCustomIntervalHours as number)
  const editChanged = nameChanged || syncPolicyChanged

  const openEditDialog = () => {
    setNextName(source.name)
    setNextSyncMode(sourceSyncMode(source))
    setNextCustomIntervalHours(sourceCustomIntervalHours(source))
    setMenuOpen(false)
    setEditDialogOpen(true)
  }

  const submitEdit = async () => {
    const name = nextName.trim()
    if (!name || !customIntervalValid || !editChanged || pendingAction) return
    if (
      await onEdit({
        customIntervalHours: nextCustomIntervalHours as number,
        name,
        syncMode: nextSyncMode,
      })
    )
      setEditDialogOpen(false)
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
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submitEdit()
            }}
          >
            <DialogTitle className="title-xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.edit'])} {source.name}
            </DialogTitle>
            <label
              className="mt-5 block system-sm-medium text-text-secondary"
              htmlFor={`source-name-${source.id}`}
            >
              {t(($) => $['newKnowledge.sourceName'])}
            </label>
            <Input
              id={`source-name-${source.id}`}
              autoComplete="off"
              className="mt-2 w-full"
              disabled={pendingAction === 'edit'}
              maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
              value={nextName}
              onChange={(event) => setNextName(event.target.value)}
            />
            <div className="mt-4">
              <SyncPolicyField
                disabled={pendingAction === 'edit'}
                label
                triggerClassName="w-full"
                value={{
                  customIntervalSeconds:
                    typeof nextCustomIntervalHours === 'number'
                      ? nextCustomIntervalHours * 3600
                      : undefined,
                  mode: nextSyncMode,
                }}
                onChange={(value) => {
                  setNextSyncMode(value.mode)
                  if (value.customIntervalSeconds)
                    setNextCustomIntervalHours(value.customIntervalSeconds / 3600)
                }}
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                disabled={pendingAction === 'edit'}
                onClick={() => setEditDialogOpen(false)}
                type="button"
              >
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                disabled={
                  pendingAction === 'edit' ||
                  !nextName.trim() ||
                  !customIntervalValid ||
                  !editChanged
                }
                loading={pendingAction === 'edit'}
                type="submit"
                variant="primary"
              >
                {tCommon(($) => $['operation.save'])}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
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
              disabled={pendingAction === 'remove'}
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
