'use client'

import type { SkillResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { SkillCardTags } from '@/features/skills/list/skill-card-tags'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { downloadBlob } from '@/utils/download'
import { getErrorMessage } from '@/utils/error-message'
import { fetchSkillArchiveBlob } from '../client'
import { getSkillErrorCode } from '../error'
import { SkillLoadError, SkillReferencesList, SkillReferencesListSkeleton } from '../references'
import { invalidateSkillListQueries } from './query'

function SkillIcon() {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-background-default">
      <span aria-hidden className="i-custom-vender-main-nav-skill size-5 text-text-secondary" />
    </div>
  )
}

function DeleteSkillDialog({
  open,
  skill,
  onOpenChange,
}: {
  open: boolean
  skill: SkillResponse
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
  const deleteMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const referencesQuery = useQuery({
    ...consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skill.id,
        },
      },
      enabled: open,
    }),
    refetchOnMount: 'always',
  })
  const references = referencesQuery.data?.data ?? []
  // Deleting waits for the references, so a failed first load is shown with a retry.
  const referencesFailed = useOwnedQueryErrors(open ? [referencesQuery] : [])
  const referencesLoadError = referencesFailed && (
    <SkillLoadError
      error={referencesFailed.error}
      fallback={t(($) => $['skillManagement.detail.referencesLoadFailed'])}
      onRetry={referencesFailed.retry}
      retrying={referencesFailed.retrying}
    />
  )
  const referenceCount = Math.max(skill.reference_count ?? 0, references.length)
  const isDeleteUnavailable =
    (open && (referencesQuery.isFetching || !referencesQuery.isSuccess)) ||
    (referenceCount > 0 && confirmDeleteInput !== skill.display_name)
  const description =
    referenceCount > 0
      ? t(($) => $['skillManagement.deleteDialog.referencedDescription'], { count: referenceCount })
      : t(($) => $['skillManagement.deleteDialog.description'])

  const handleDelete = () => {
    if (deleteMutation.isPending || isDeleteUnavailable) return

    deleteMutation.mutate(
      {
        params: {
          skill_id: skill.id,
        },
        body: {
          confirmation_name: referenceCount > 0 ? skill.display_name : skill.name,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
        onError: (error) => {
          toast.error(getErrorMessage(error) ?? t(($) => $['skillManagement.deleteFailed']))
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
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            handleDelete()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['skillManagement.deleteDialog.title'], { name: skill.display_name })}
            </AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {referencesFailed && referenceCount === 0 && (
            <AlertDialogBody>{referencesLoadError}</AlertDialogBody>
          )}
          {referenceCount > 0 && (
            <AlertDialogBody className="flex flex-col gap-2">
              {referencesQuery.isPending ? (
                <SkillReferencesListSkeleton compact />
              ) : referencesFailed ? (
                referencesLoadError
              ) : (
                <SkillReferencesList
                  compact
                  maxHeight="max-h-[240px]"
                  references={references}
                  testId="skill-delete-reference-list"
                  visibleLimit={5}
                />
              )}
              <Field name="confirm-skill-name">
                <FieldLabel>
                  <Trans
                    i18nKey={($) => $['skillManagement.deleteDialog.confirmInputLabel']}
                    ns="skill"
                    values={{ skillName: skill.display_name }}
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
                    placeholder={t(
                      ($) => $['skillManagement.deleteDialog.confirmInputPlaceholder'],
                    )}
                    value={confirmDeleteInput}
                    onValueChange={setConfirmDeleteInput}
                  />
                  <InputGroupAddon align="inline-end">
                    <Button
                      variant="tertiary"
                      size="small"
                      onClick={() => setConfirmDeleteInput(skill.display_name)}
                    >
                      {tCommon(($) => $['operation.fill'])}
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            </AlertDialogBody>
          )}
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={deleteMutation.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={deleteMutation.isPending}
              disabled={isDeleteUnavailable}
              type="submit"
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function SkillCard({
  canDelete,
  canEdit,
  skill,
  onOpenTagManagement,
}: {
  canDelete: boolean
  canEdit: boolean
  skill: SkillResponse
  onOpenTagManagement: () => void
}) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const queryClient = useQueryClient()
  const router = useRouter()
  const nameId = useId()
  const descriptionId = useId()
  const draftStatusId = useId()
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const duplicateMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.duplicate.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const exportMutation = useMutation({
    meta: { errorToast: false },
    mutationFn: () => fetchSkillArchiveBlob(skill.id),
    onSuccess: (blob) => {
      downloadBlob({ data: blob, fileName: `${skill.name}.zip` })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error) ?? tCommon(($) => $['operation.downloadFailed']))
    },
  })
  const isDraft = !skill.latest_published_version_id
  const accessibleDescriptionIds = isDraft ? `${draftStatusId} ${descriptionId}` : descriptionId
  const updatedAt = formatTimeFromNow(skill.updated_at * 1000)
  const publishedAt = skill.latest_published_at
    ? formatTimeFromNow(skill.latest_published_at * 1000)
    : undefined

  const handleDuplicate = () => {
    if (duplicateMutation.isPending) return

    duplicateMutation.mutate(
      {
        params: {
          skill_id: skill.id,
        },
      },
      {
        onSuccess: (copiedSkill) => {
          router.push(`/skills/${copiedSkill.id}?rename=true`)
        },
        onError: (error) => {
          toast.error(
            getSkillErrorCode(error) === 'skill_limit_exceeded'
              ? t(($) => $['skillManagement.errors.workspaceLimit'])
              : (getErrorMessage(error) ?? t(($) => $['skillManagement.duplicateFailed'])),
          )
        },
      },
    )
  }

  const handleExport = () => {
    if (exportMutation.isPending) return

    exportMutation.mutate()
  }

  return (
    <li
      aria-labelledby={nameId}
      className="group relative isolate col-span-1 h-42 min-w-0 overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow duration-200 ease-in-out after:pointer-events-none after:absolute after:inset-0 after:z-1 after:rounded-xl after:content-[''] focus-within:bg-components-card-bg-alt focus-within:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)] hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5 hover:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)] has-data-popup-open:bg-components-card-bg-alt has-data-popup-open:shadow-md has-data-popup-open:shadow-shadow-shadow-5 has-data-popup-open:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)] has-[>a:focus-visible]:after:inset-ring-2 has-[>a:focus-visible]:after:inset-ring-state-accent-solid motion-reduce:transition-none [@media(hover:none)]:bg-components-card-bg-alt [@media(hover:none)]:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)]"
    >
      <Link
        href={`/skills/${skill.id}`}
        aria-labelledby={nameId}
        aria-describedby={accessibleDescriptionIds}
        className="flex h-full min-w-0 cursor-pointer touch-manipulation flex-col rounded-xl outline-hidden"
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <SkillIcon />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
            <h2 id={nameId} className="truncate system-md-semibold text-text-secondary">
              {skill.display_name}
            </h2>
            {!skill.name.startsWith('untitled-skill-') && (
              <p className="truncate system-xs-regular text-text-tertiary">{skill.name}</p>
            )}
          </div>
        </div>
        <div className="px-4 py-1 system-xs-regular text-text-tertiary">
          <div id={descriptionId} className="line-clamp-2 min-h-8">
            {skill.description.trim()
              ? skill.description
              : t(($) => $['skillManagement.noDescription'])}
          </div>
        </div>
        <div className="h-6.5 shrink-0" />
        <div className="flex min-w-0 shrink-0 items-center ps-4 pe-3 pt-2 pb-3 system-xs-regular text-text-tertiary">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="shrink-0">
              {t(($) => $['skillManagement.referenceCount'], { count: skill.reference_count ?? 0 })}
            </span>
            <span aria-hidden className="shrink-0 text-text-quaternary">
              ·
            </span>
            <span className="min-w-0 truncate">
              {isDraft
                ? t(($) => $['skillManagement.editedAt'], { time: updatedAt })
                : t(($) => $['skillManagement.publishedAt'], { time: publishedAt ?? '-' })}
            </span>
          </div>
        </div>
      </Link>
      {isDraft && (
        <div
          id={draftStatusId}
          className="pointer-events-none absolute inset-e-0 top-[-0.5px] flex h-5 items-start overflow-hidden"
        >
          <div className="h-5 w-3 bg-background-section-burn [clip-path:polygon(0_0,100%_0,100%_100%)] rtl:-scale-x-100" />
          <div className="flex h-5 items-center bg-background-section-burn ps-0.5 pe-2 system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $['skillManagement.draft'])}
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-e-[-0.5px] top-[-0.5px] flex h-16 w-30 items-start justify-end bg-[linear-gradient(67deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] p-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100 rtl:bg-[linear-gradient(293deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] [@media(hover:none)]:opacity-100">
        <div className="pointer-events-none flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs group-focus-within:pointer-events-auto group-hover:pointer-events-auto has-data-popup-open:pointer-events-auto [@media(hover:none)]:pointer-events-auto">
          <Menu modal={false}>
            <MenuTrigger
              render={
                <IconButton
                  aria-label={t(($) => $['skillManagement.moreActions'], {
                    name: skill.display_name,
                  })}
                  size="lg"
                  className="data-popup-open:bg-state-base-hover"
                >
                  <span aria-hidden className="i-ri-more-fill size-4.5" />
                </IconButton>
              }
            />
            <MenuContent align="end" className="w-40">
              {canEdit && (
                <MenuItem className="gap-2" onClick={handleDuplicate}>
                  <span
                    aria-hidden
                    className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary"
                  />
                  <span>{tCommon(($) => $['operation.duplicate'])}</span>
                </MenuItem>
              )}
              <MenuItem
                className="gap-2"
                disabled={exportMutation.isPending}
                onClick={handleExport}
              >
                <span
                  aria-hidden
                  className="i-ri-download-2-line size-4 shrink-0 text-text-tertiary"
                />
                <span>{tCommon(($) => $['operation.export'])}</span>
              </MenuItem>
              {canDelete && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    variant="destructive"
                    className="gap-2"
                    onClick={() => setIsDeleteOpen(true)}
                  >
                    <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                    <span>{tCommon(($) => $['operation.delete'])}</span>
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-s-3 inset-e-3 top-26 flex h-6.5 min-w-0 items-start">
        <div className="pointer-events-auto w-full min-w-0">
          <SkillCardTags
            skillId={skill.id}
            tags={skill.tags ?? []}
            onOpenTagManagement={onOpenTagManagement}
            onTagsChange={() => invalidateSkillListQueries(queryClient)}
          />
        </div>
      </div>
      <DeleteSkillDialog skill={skill} open={isDeleteOpen} onOpenChange={setIsDeleteOpen} />
    </li>
  )
}
