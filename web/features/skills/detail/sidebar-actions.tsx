'use client'

import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { fetchSkillArchiveBlob } from '../client'
import { SkillReferencesList, SkillReferencesListSkeleton } from './skill-metadata'

function invalidateSkillListQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
  })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
  })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
  })
}

function SkillDetailDeleteDialog({
  detail,
  onOpenChange,
  open,
}: {
  detail: SkillDetailResponse
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
  const queryClient = useQueryClient()
  const router = useRouter()
  const deleteMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.delete.mutationOptions(),
  )
  const referencesQuery = useQuery({
    ...consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: detail.id,
        },
      },
    }),
    enabled: open,
    refetchOnMount: 'always',
  })
  const references = referencesQuery.data?.data ?? []
  const referenceCount = Math.max(detail.reference_count ?? 0, references.length)
  const isDeleteDisabled =
    deleteMutation.isPending ||
    (open && (referencesQuery.isFetching || !referencesQuery.isSuccess)) ||
    (referenceCount > 0 && confirmDeleteInput !== detail.display_name)
  const description =
    referenceCount > 0
      ? t(
          ($) =>
            referenceCount === 1
              ? $['skillManagement.deleteDialog.referencedDescription_one']
              : $['skillManagement.deleteDialog.referencedDescription_other'],
          { count: referenceCount },
        )
      : t(($) => $['skillManagement.deleteDialog.description'])

  const handleDelete = () => {
    if (isDeleteDisabled) return

    deleteMutation.mutate(
      {
        params: {
          skill_id: detail.id,
        },
        body: {
          confirmation_name: referenceCount > 0 ? detail.display_name : detail.name,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.deleteSuccess']))
          invalidateSkillListQueries(queryClient)
          onOpenChange(false)
          router.push('/skills')
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.deleteFailed']))
        },
      },
    )
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setConfirmDeleteInput('')
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle
            className="truncate title-2xl-semi-bold text-text-primary"
            title={t(($) => $['skillManagement.deleteDialog.title'], { name: detail.display_name })}
          >
            {t(($) => $['skillManagement.deleteDialog.title'], { name: detail.display_name })}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
            {description}
          </AlertDialogDescription>
          {referenceCount > 0 && (
            <div className="mt-4">
              {referencesQuery.isPending ? (
                <SkillReferencesListSkeleton compact />
              ) : (
                <SkillReferencesList
                  compact
                  maxHeight="max-h-[240px]"
                  references={references}
                  testId="skill-delete-reference-list"
                  visibleLimit={5}
                />
              )}
            </div>
          )}
          {referenceCount > 0 && (
            <Field name="confirm-skill-name" className="mt-2">
              <FieldLabel className="mb-1 block py-0 system-sm-regular text-text-secondary">
                <Trans
                  i18nKey={($) => $['skillManagement.deleteDialog.confirmInputLabel']}
                  ns="skill"
                  values={{ skillName: detail.display_name }}
                  components={{
                    skillName: (
                      <span className="system-sm-semibold text-text-primary" translate="no" />
                    ),
                  }}
                />
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t(($) => $['skillManagement.deleteDialog.confirmInputPlaceholder'])}
                  value={confirmDeleteInput}
                  onValueChange={setConfirmDeleteInput}
                />
                <InputGroupAddon align="inline-end">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteInput(detail.display_name)}
                    className="rounded-full bg-black/6 px-2.5 py-1 system-xs-medium text-text-secondary hover:bg-black/10"
                  >
                    {tCommon(($) => $['operation.fill'])}
                  </button>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          )}
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton disabled={deleteMutation.isPending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="destructive"
            loading={deleteMutation.isPending}
            disabled={isDeleteDisabled}
            onClick={handleDelete}
          >
            {tCommon(($) => (referenceCount > 0 ? $['operation.confirm'] : $['operation.delete']))}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function SkillDetailSidebarActions({
  canDelete,
  canEdit,
  detail,
  onRename,
}: {
  canDelete: boolean
  canEdit: boolean
  detail: SkillDetailResponse
  onRename: () => void
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const duplicateMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.duplicate.post.mutationOptions(),
  )
  const exportMutation = useMutation({
    mutationFn: () => fetchSkillArchiveBlob(detail.id),
    onSuccess: (blob) => {
      downloadBlob({ data: blob, fileName: `${detail.name}.zip` })
    },
    onError: () => {
      toast.error(tCommon(($) => $['operation.downloadFailed']))
    },
  })

  const handleDuplicate = () => {
    if (duplicateMutation.isPending) return

    duplicateMutation.mutate(
      {
        params: {
          skill_id: detail.id,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.duplicateSuccess']))
          invalidateSkillListQueries(queryClient)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.duplicateFailed']))
        },
      },
    )
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t(($) => $['skillManagement.moreActions'], {
            name: detail.display_name,
          })}
          className="mt-px flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
        >
          <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-40">
          {canEdit && (
            <DropdownMenuItem className="gap-2" onClick={onRename}>
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span>{tCommon(($) => $['operation.rename'])}</span>
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem className="gap-2" onClick={handleDuplicate}>
              <span
                aria-hidden
                className="i-ri-file-copy-2-line size-4 shrink-0 text-text-tertiary"
              />
              <span>{tCommon(($) => $['operation.duplicate'])}</span>
            </DropdownMenuItem>
          )}
          {detail.latest_published_version_id && (
            <DropdownMenuItem
              className="gap-2"
              onClick={() => {
                if (!exportMutation.isPending) exportMutation.mutate()
              }}
            >
              <span
                aria-hidden
                className="i-ri-file-download-line size-4 shrink-0 text-text-tertiary"
              />
              <span>{tCommon(($) => $['operation.export'])}</span>
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="gap-2"
                onClick={() => setDeleteOpen(true)}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                <span>{tCommon(($) => $['operation.delete'])}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SkillDetailDeleteDialog detail={detail} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  )
}
