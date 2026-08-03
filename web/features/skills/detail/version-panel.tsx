'use client'

import type { SkillVersionResponse } from '@dify/contracts/api/console/workspaces/types.gen'
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
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import copy from 'copy-to-clipboard'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'
import { getSkillVersionTitle, invalidateSkillDetail } from './shared'

function VersionRow({
  onSelect,
  selected,
  skillId,
  version,
}: {
  onSelect: (versionId: string | null) => void
  selected: boolean
  skillId: string
  version: SkillVersionResponse
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const { formatTime } = useTimestamp()
  const queryClient = useQueryClient()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [versionName, setVersionName] = useState(version.version_name)
  const [publishNote, setPublishNote] = useState(version.publish_note)
  const renameMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.patch.mutationOptions(),
  )
  const restoreMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.restore.post.mutationOptions(),
  )
  const deleteMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.delete.mutationOptions(),
  )
  const publishedBy = version.published_by_name ?? version.published_by ?? '-'
  const versionTitle = getSkillVersionTitle(version)
  const versionInfoLabel = version.is_latest
    ? t(($) => $['skillManagement.detail.editVersionInfo'])
    : t(($) => $['skillManagement.detail.nameThisVersion'])

  const invalidateVersions = () => invalidateSkillDetail(queryClient, skillId)

  const handleRename = () => {
    const trimmedName = versionName.trim()

    renameMutation.mutate(
      {
        params: {
          skill_id: skillId,
          version_id: version.id,
        },
        body: {
          publish_note: publishNote,
          version_name: trimmedName,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.detail.renameVersionSuccess']))
          setRenameOpen(false)
          invalidateVersions()
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.renameVersionFailed']))
        },
      },
    )
  }

  const handleRestore = () => {
    restoreMutation.mutate(
      {
        params: {
          skill_id: skillId,
        },
        body: {
          version_id: version.id,
          version_name: version.version_name,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.detail.restoreVersionSuccess']))
          invalidateVersions()
          onSelect(null)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.restoreVersionFailed']))
        },
      },
    )
  }

  const handleCopyId = () => {
    copy(version.id)
    toast.success(t(($) => $['skillManagement.detail.copyVersionIdSuccess']))
  }

  const handleDelete = () => {
    deleteMutation.mutate(
      {
        params: {
          skill_id: skillId,
          version_id: version.id,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.detail.deleteVersionSuccess']))
          setDeleteOpen(false)
          invalidateVersions()
          onSelect(null)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.deleteVersionFailed']))
        },
      },
    )
  }

  return (
    <>
      <li>
        <div
          className={cn(
            'flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-state-base-hover',
            selected && 'bg-state-base-hover',
          )}
        >
          <span
            aria-hidden
            className="mt-0.5 i-ri-git-commit-line size-4 shrink-0 text-text-tertiary"
          />
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => onSelect(version.id)}
          >
            <span className="block min-w-0">
              <span className="flex min-w-0 items-center gap-1">
                <span
                  className={cn(
                    'truncate system-xs-semibold',
                    selected ? 'text-text-accent' : 'text-text-secondary',
                  )}
                >
                  {versionTitle}
                </span>
                {version.is_latest && (
                  <span className="shrink-0 rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-accent-secondary">
                    {t(($) => $['skillManagement.detail.latest'])}
                  </span>
                )}
              </span>
              {version.publish_note && (
                <span className="mt-0.5 block system-xs-regular break-words text-text-secondary">
                  {version.publish_note}
                </span>
              )}
              <span className="mt-0.5 block truncate system-xs-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.versionPublishedMeta'], {
                  name: publishedBy,
                  time: formatTime(
                    version.created_at,
                    t(($) => $['skillManagement.dateTimeFormat']),
                  ),
                })}
              </span>
            </span>
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover">
              <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
            </DropdownMenuTrigger>
            <DropdownMenuContent placement="bottom-end" popupClassName="w-40">
              <DropdownMenuItem className="gap-2" onClick={handleRestore}>
                <span aria-hidden className="i-ri-history-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.restoreVersion'])}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onClick={() => {
                  setVersionName(version.version_name)
                  setPublishNote(version.publish_note)
                  setRenameOpen(true)
                }}
              >
                <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
                <span>{versionInfoLabel}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={handleCopyId}>
                <span aria-hidden className="i-ri-file-copy-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.copyVersionId'])}</span>
              </DropdownMenuItem>
              {!version.is_latest && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    className="gap-2"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <span aria-hidden className="i-ri-delete-bin-line size-4" />
                    <span>{tCommon(($) => $['operation.delete'])}</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="w-full max-w-[480px] overflow-hidden! border-none p-0 text-left align-middle">
          <DialogCloseButton />
          <div className="px-6 pt-6 pr-14 pb-4">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {versionInfoLabel}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t(($) => $['skillManagement.detail.renameVersionPrompt'])}
            </DialogDescription>
          </div>
          <div className="flex flex-col gap-y-4 px-6 py-3">
            <Field name="versionTitle" className="gap-y-1">
              <FieldLabel className="flex h-6 items-center py-0 system-sm-semibold text-text-secondary">
                {t(($) => $['skillManagement.detail.versionTitle'])}
              </FieldLabel>
              <FieldControl
                value={versionName}
                placeholder={t(($) => $['skillManagement.detail.nameThisVersion'])}
                onValueChange={setVersionName}
              />
            </Field>
            <Field name="publishNote" className="gap-y-1">
              <FieldLabel className="flex h-6 items-center py-0 system-sm-semibold text-text-secondary">
                {t(($) => $['skillManagement.detail.versionPublishNote'])}
              </FieldLabel>
              <Textarea
                value={publishNote}
                placeholder={t(($) => $['skillManagement.detail.versionPublishNotePlaceholder'])}
                onValueChange={setPublishNote}
              />
            </Field>
          </div>
          <div className="flex justify-end p-6 pt-5">
            <div className="flex items-center gap-x-3">
              <Button disabled={renameMutation.isPending} onClick={() => setRenameOpen(false)}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button variant="primary" loading={renameMutation.isPending} onClick={handleRename}>
                {t(($) => $['skillManagement.detail.publish'])}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="p-6">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['skillManagement.detail.deleteVersionConfirm'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 system-md-regular text-text-tertiary">
            {versionTitle}
          </AlertDialogDescription>
          <AlertDialogActions className="p-0 pt-6">
            <AlertDialogCancelButton disabled={deleteMutation.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              loading={deleteMutation.isPending}
              onClick={handleDelete}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function VersionPanel({
  onClose,
  onSelect,
  selectedVersionId,
  skillId,
  versions,
}: {
  onClose: () => void
  onSelect: (versionId: string | null) => void
  selectedVersionId: string | null
  skillId: string
  versions: SkillVersionResponse[]
}) {
  const { t } = useTranslation('skill')

  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-hidden bg-background-default">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-divider-subtle px-5">
        <h2 className="system-sm-semibold text-text-secondary">
          {t(($) => $['skillManagement.detail.versions'])}
        </h2>
        <div className="flex items-center gap-1">
          {selectedVersionId && (
            <Button className="h-7 px-2" onClick={() => onSelect(null)}>
              {t(($) => $['skillManagement.detail.currentDraft'])}
            </Button>
          )}
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.closeVersions'])}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={onClose}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <ScrollAreaViewport tabIndex={-1}>
          <ScrollAreaContent className="p-2">
            {versions.length === 0 ? (
              <p className="px-2 py-3 system-xs-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.noVersions'])}
              </p>
            ) : (
              <ul className="space-y-1">
                {versions.map((version) => (
                  <VersionRow
                    key={version.id}
                    version={version}
                    skillId={skillId}
                    selected={selectedVersionId === version.id}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            )}
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>
    </aside>
  )
}
