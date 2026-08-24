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
  DialogClose,
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
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'
import { getSkillVersionTitle, invalidateSkillDetail } from './shared'

type VersionFilterValue = 'all' | 'onlyNamed'

export function RestoreVersionDialog({
  loading,
  onConfirm,
  onOpenChange,
  open,
  versionTitle,
}: {
  loading: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  versionTitle: string
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="p-6">
        <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['skillManagement.detail.restoreVersionConfirmTitle'])}
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-2 system-md-regular whitespace-pre-line text-text-tertiary">
          {t(($) => $['skillManagement.detail.restoreVersionConfirmDescription'], {
            version: versionTitle,
          })}
        </AlertDialogDescription>
        <AlertDialogActions className="p-0 pt-6">
          <AlertDialogCancelButton disabled={loading}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton loading={loading} onClick={onConfirm}>
            {t(($) => $['skillManagement.detail.restoreVersion'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function VersionTimelineDot({
  isActive,
  isFirst,
  isLast,
}: {
  isActive: boolean
  isFirst: boolean
  isLast: boolean
}) {
  return (
    <div className="relative flex w-4.5 shrink-0 justify-center pt-1.5">
      {!isFirst && <div className="absolute top-0 h-2 w-0.5 bg-divider-subtle" />}
      <span
        aria-hidden
        className={cn(
          'relative z-1 size-2 rounded-full border-2 bg-components-panel-bg',
          isActive ? 'border-text-accent' : 'border-text-quaternary',
        )}
      />
      {!isLast && <div className="absolute top-3 -bottom-4.5 w-0.5 bg-divider-subtle" />}
    </div>
  )
}

function CurrentDraftItem({
  isActive,
  isLast,
  onSelect,
}: {
  isActive: boolean
  isLast: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('skill')

  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-1 rounded-lg py-1 pr-[5px] pl-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        isActive ? 'bg-state-accent-active' : 'hover:bg-state-base-hover',
      )}
    >
      <VersionTimelineDot isActive={isActive} isFirst isLast={isLast} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate py-1 system-sm-semibold',
          isActive ? 'text-text-accent' : 'text-text-secondary',
        )}
      >
        {t(($) => $['skillManagement.detail.currentDraft'])}
      </span>
    </button>
  )
}

function VersionFilter({
  value,
  onChange,
}: {
  value: VersionFilterValue
  onChange: (value: VersionFilterValue) => void
}) {
  const { t } = useTranslation('skill')
  const { t: tWorkflow } = useTranslation('workflow')
  const [open, setOpen] = useState(false)
  const isFiltering = value !== 'all'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <button
            type="button"
            aria-label={`${t(($) => $['skillManagement.detail.versions'])}: ${
              value === 'all'
                ? tWorkflow(($) => $['versionHistory.filter.all'])
                : tWorkflow(($) => $['versionHistory.filter.onlyShowNamedVersions'])
            }`}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md p-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              isFiltering
                ? 'bg-state-accent-active-alt text-text-accent'
                : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            )}
          >
            <span aria-hidden className="i-ri-filter-3-line size-4" />
          </button>
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={55}
        className="border-none bg-transparent shadow-none"
      >
        <div className="flex w-62 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
          {(['all', 'onlyNamed'] as const).map((filterValue) => (
            <button
              key={filterValue}
              type="button"
              className="flex h-8 w-full cursor-pointer items-center justify-between gap-1 rounded-lg px-2 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={() => {
                onChange(filterValue)
                setOpen(false)
              }}
            >
              <span className="min-w-0 flex-1 truncate system-md-regular text-text-primary">
                {filterValue === 'all'
                  ? tWorkflow(($) => $['versionHistory.filter.all'])
                  : tWorkflow(($) => $['versionHistory.filter.onlyShowNamedVersions'])}
              </span>
              {value === filterValue && (
                <span aria-hidden className="i-ri-check-line size-4 shrink-0 text-text-accent" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function VersionRow({
  isFirst,
  isLast,
  onSelect,
  selected,
  skillId,
  version,
}: {
  isFirst: boolean
  isLast: boolean
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
  const [restoreOpen, setRestoreOpen] = useState(false)
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
          setRestoreOpen(false)
          invalidateVersions()
          onSelect(null)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.restoreVersionFailed']))
        },
      },
    )
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
      <li className="group relative">
        <div
          className={cn(
            'relative flex w-full items-start gap-1 rounded-lg py-1 pr-[5px] pl-2 text-left outline-hidden focus-within:ring-2 focus-within:ring-state-accent-solid',
            selected ? 'bg-state-accent-active' : 'hover:bg-state-base-hover',
          )}
        >
          <VersionTimelineDot isActive={selected} isFirst={isFirst} isLast={isLast} />
          <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            className="min-w-0 flex-1 cursor-pointer py-0.5 text-left outline-hidden"
            onClick={() => onSelect(version.id)}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1 py-px pr-6">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate system-sm-semibold',
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
                <span className="block system-xs-regular break-words text-text-secondary">
                  {version.publish_note}
                </span>
              )}
              <span className="block truncate pt-0.5 system-xs-regular text-text-tertiary">
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
            <DropdownMenuTrigger
              aria-label={tCommon(($) => $['operation.more'])}
              className="absolute top-1 right-1 flex size-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-1 opacity-0 shadow-xs outline-hidden group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:opacity-100"
            >
              <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
            </DropdownMenuTrigger>
            <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-[184px]">
              <DropdownMenuItem onClick={() => setRestoreOpen(true)}>
                {t(($) => $['skillManagement.detail.restoreVersion'])}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setVersionName(version.version_name)
                  setPublishNote(version.publish_note)
                  setRenameOpen(true)
                }}
              >
                {versionInfoLabel}
              </DropdownMenuItem>
              {!version.is_latest && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                    {tCommon(($) => $['operation.delete'])}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="w-full max-w-[480px] overflow-hidden! border-none p-0 text-left align-middle">
          <DialogClose
            render={
              <IconButton
                aria-label={tCommon(($) => $['operation.close'])}
                size="lg"
                className="absolute top-6 right-6"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
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
              <Input
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
      <RestoreVersionDialog
        open={restoreOpen}
        loading={restoreMutation.isPending}
        versionTitle={versionTitle}
        onOpenChange={setRestoreOpen}
        onConfirm={handleRestore}
      />
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
  const { t: tWorkflow } = useTranslation('workflow')
  const [filterValue, setFilterValue] = useState<VersionFilterValue>('all')
  const filteredVersions = versions.filter((version) => {
    if (filterValue === 'onlyNamed') return !!version.version_name

    return true
  })

  return (
    <aside className="flex w-67 shrink-0 flex-col py-1">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-l-lg bg-components-panel-bg">
        <div className="flex shrink-0 items-center gap-2 pt-3 pr-3 pl-4">
          <h2 className="min-w-0 flex-1 truncate system-xl-semibold text-text-primary">
            {t(($) => $['skillManagement.detail.versions'])}
          </h2>
          <VersionFilter value={filterValue} onChange={setFilterValue} />
          <div className="h-3.5 w-px shrink-0 bg-divider-regular" />
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.closeVersions'])}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md p-0.5 text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={onClose}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
          <div className="flex min-w-0 flex-col gap-px">
            <CurrentDraftItem
              isActive={selectedVersionId === null}
              isLast={filteredVersions.length === 0}
              onSelect={() => onSelect(null)}
            />
            {versions.length === 0 && (
              <p className="rounded-lg px-3 py-6 text-center system-sm-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.noVersions'])}
              </p>
            )}
            {versions.length > 0 && filteredVersions.length === 0 && (
              <div className="rounded-lg px-3 py-6 text-center">
                <p className="system-sm-regular text-text-tertiary">
                  {tWorkflow(($) => $['versionHistory.filter.empty'])}
                </p>
                <button
                  type="button"
                  className="mt-2 rounded-md px-2 py-1 system-xs-medium text-text-accent outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={() => setFilterValue('all')}
                >
                  {tWorkflow(($) => $['versionHistory.filter.reset'])}
                </button>
              </div>
            )}
            {filteredVersions.length > 0 && (
              <ul className="flex flex-col gap-px">
                {filteredVersions.map((version, index) => (
                  <VersionRow
                    key={version.id}
                    isFirst={false}
                    isLast={index === filteredVersions.length - 1}
                    version={version}
                    skillId={skillId}
                    selected={selectedVersionId === version.id}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
