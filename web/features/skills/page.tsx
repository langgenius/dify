'use client'

import type { SkillResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { UIEvent } from 'react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useQueryState } from 'nuqs'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { SkillCardTags } from '@/features/tag-management/components/skill-card-tags'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import useDocumentTitle from '@/hooks/use-document-title'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { fetchSkillArchiveBlob } from './client'
import { SkillReferencesList, SkillReferencesListSkeleton } from './detail/skill-metadata'
import { getSkillErrorCode, getSkillErrorDetailString, normalizeSkillError } from './error'
import { useSkillPermissions } from './permissions'
import { skillKeywordQueryParser, skillQueryParamNames, skillTagQueryParser } from './query-params'
import { SkillListTagManagementModal } from './skill-list-tag-management-modal'

const placeholderCardIds = Array.from(
  { length: 16 },
  (_, index) => `skill-placeholder-card-${index}`,
)
const skeletonRows = ['primary', 'secondary', 'tertiary'] as const
const SKILLS_PAGE_SIZE = 20

function skillsListQueryKey(type: 'infinite' | 'query') {
  return consoleQuery.workspaces.current.skills.get.key({ type })
}

function invalidateSkillListQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: skillsListQueryKey('query') })
  void queryClient.invalidateQueries({ queryKey: skillsListQueryKey('infinite') })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
  })
}

function SkillIcon() {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-background-default">
      <span aria-hidden className="i-custom-vender-main-nav-skill size-5 text-text-secondary" />
    </div>
  )
}

function SkillCardSkeleton() {
  return (
    <>
      {skeletonRows.map((row) => (
        <div
          key={row}
          className="relative h-42 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3"
        >
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <SkeletonRectangle className="my-0 size-10 shrink-0 rounded-[10px] opacity-20" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <SkeletonRectangle className="my-0 h-3 w-36 max-w-full rounded-md opacity-20" />
              <SkeletonRectangle className="my-0 h-2 w-24 max-w-full rounded-md opacity-12" />
            </div>
          </div>
          <div className="px-4 py-1">
            <SkeletonRectangle className="my-0 h-2 w-full rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 mt-2 h-2 w-3/4 rounded-md opacity-10" />
          </div>
          <div className="flex gap-1 px-4 pt-2">
            <SkeletonRectangle className="my-0 h-5 w-14 rounded-md opacity-12" />
            <SkeletonRectangle className="my-0 h-5 w-20 rounded-md opacity-10" />
          </div>
        </div>
      ))}
    </>
  )
}

function SkillPlaceholderState({
  canEdit,
  creating,
  importing,
  isEmptySearch,
  onCreate,
  onImport,
  title,
}: {
  canEdit?: boolean
  creating?: boolean
  importing?: boolean
  isEmptySearch?: boolean
  onCreate?: () => void
  onImport?: () => void
  title: string
}) {
  const { t } = useTranslation('skill')

  return (
    <section
      aria-labelledby="skill-placeholder-title"
      className="relative col-span-full min-h-[calc(100vh-142px)] overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-0 grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] grid-rows-4 gap-3">
        {placeholderCardIds.map((id) => (
          <div key={id} className="rounded-xl bg-background-default-lighter opacity-75" />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-background-body/0 to-background-body" />
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden px-2 pt-2 pb-16">
        <div className="flex w-[520px] max-w-full flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-[10px]">
              <div className="flex size-full min-w-px items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md">
                <span
                  aria-hidden
                  className="i-custom-vender-agent-v2-building-blocks size-6 text-text-tertiary"
                />
              </div>
            </div>
            <h2
              id="skill-placeholder-title"
              className="system-sm-regular whitespace-nowrap text-text-tertiary"
            >
              {title}
            </h2>
          </div>
          {!isEmptySearch && canEdit !== false && (
            <div className="flex w-full flex-col gap-2">
              <button
                type="button"
                disabled={creating || importing}
                className="flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl bg-components-button-secondary-bg px-3 py-2.5 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onCreate}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-section">
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 text-text-tertiary',
                      creating ? 'i-ri-loader-4-line animate-spin' : 'i-ri-chat-ai-line',
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate system-md-medium text-text-secondary"
                    title={t(($) => $['skillManagement.emptyAction.createTitle'])}
                  >
                    {t(($) => $['skillManagement.emptyAction.createTitle'])}
                  </span>
                  <span
                    className="block truncate system-xs-regular text-text-tertiary"
                    title={t(($) => $['skillManagement.emptyAction.createDescription'])}
                  >
                    {t(($) => $['skillManagement.emptyAction.createDescription'])}
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={creating || importing}
                className="flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl bg-components-button-secondary-bg px-3 py-2.5 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onImport}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-section">
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 text-text-tertiary',
                      importing ? 'i-ri-loader-4-line animate-spin' : 'i-ri-upload-line',
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate system-md-medium text-text-secondary"
                    title={t(($) => $['skillManagement.emptyAction.importTitle'])}
                  >
                    {t(($) => $['skillManagement.emptyAction.importTitle'])}
                  </span>
                  <span
                    className="block truncate system-xs-regular text-text-tertiary"
                    title={t(($) => $['skillManagement.emptyAction.importDescription'])}
                  >
                    {t(($) => $['skillManagement.emptyAction.importDescription'])}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
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
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
  const queryClient = useQueryClient()
  const deleteMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.delete.mutationOptions(),
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
  const referenceCount = Math.max(skill.reference_count ?? 0, references.length)
  const isDeleteDisabled =
    deleteMutation.isPending ||
    (open && (referencesQuery.isFetching || !referencesQuery.isSuccess)) ||
    (referenceCount > 0 && confirmDeleteInput !== skill.display_name)
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
          skill_id: skill.id,
        },
        body: {
          confirmation_name: referenceCount > 0 ? skill.display_name : skill.name,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.deleteSuccess']))
          invalidateSkillListQueries(queryClient)
          onOpenChange(false)
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
            title={t(($) => $['skillManagement.deleteDialog.title'], { name: skill.display_name })}
          >
            {t(($) => $['skillManagement.deleteDialog.title'], { name: skill.display_name })}
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
                  placeholder={t(($) => $['skillManagement.deleteDialog.confirmInputPlaceholder'])}
                  value={confirmDeleteInput}
                  onValueChange={setConfirmDeleteInput}
                />
                <InputGroupAddon align="inline-end">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteInput(skill.display_name)}
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
            {tCommon(($) => $['operation.delete'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SkillCard({
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
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const queryClient = useQueryClient()
  const nameId = useId()
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const duplicateMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.duplicate.post.mutationOptions(),
  )
  const exportMutation = useMutation({
    mutationFn: () => fetchSkillArchiveBlob(skill.id),
    onSuccess: (blob) => {
      downloadBlob({ data: blob, fileName: `${skill.name}.zip` })
    },
    onError: () => {
      toast.error(tCommon(($) => $['operation.downloadFailed']))
    },
  })
  const isDraft = !skill.latest_published_version_id
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

  const handleExport = () => {
    if (exportMutation.isPending) return

    exportMutation.mutate()
  }

  return (
    <article
      aria-labelledby={nameId}
      className="group relative col-span-1 h-42 min-w-0 overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow duration-200 ease-in-out after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:shadow-lg has-[>div>a:focus-visible]:after:inset-ring-2 has-[>div>a:focus-visible]:after:inset-ring-state-accent-solid"
    >
      <div className="flex h-full min-w-0 flex-col">
        <Link
          href={`/skills/${skill.id}`}
          aria-labelledby={nameId}
          className="block min-w-0 shrink-0 cursor-pointer outline-hidden"
        >
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <SkillIcon />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
              <h2
                id={nameId}
                className="truncate system-md-semibold text-text-secondary"
                title={skill.display_name}
              >
                {skill.display_name}
              </h2>
              {!skill.name.startsWith('untitled-skill-') && (
                <p className="truncate system-xs-regular text-text-tertiary" title={skill.name}>
                  {skill.name}
                </p>
              )}
            </div>
          </div>
          <div className="px-4 py-1 system-xs-regular text-text-tertiary">
            <div
              className="line-clamp-2 min-h-8"
              title={
                skill.description.trim()
                  ? skill.description
                  : t(($) => $['skillManagement.noDescription'])
              }
            >
              {skill.description.trim()
                ? skill.description
                : t(($) => $['skillManagement.noDescription'])}
            </div>
          </div>
        </Link>
        {(canEdit || canDelete || !!skill.latest_published_version_id) && (
          <div
            className={cn(
              'pointer-events-none absolute right-2 z-20 flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 opacity-0 shadow-lg backdrop-blur-xs transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 has-data-popup-open:pointer-events-auto has-data-popup-open:opacity-100',
              isDraft ? 'top-7' : 'top-2',
            )}
          >
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                aria-label={t(($) => $['skillManagement.moreActions'], {
                  name: skill.display_name,
                })}
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg p-1.5 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="sr-only">
                  {t(($) => $['skillManagement.moreActions'], { name: skill.display_name })}
                </span>
                <span aria-hidden className="i-ri-more-fill size-4.5 text-text-tertiary" />
              </DropdownMenuTrigger>
              <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-40">
                {canEdit && (
                  <DropdownMenuItem className="gap-2" onClick={handleDuplicate}>
                    <span
                      aria-hidden
                      className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary"
                    />
                    <span>{tCommon(($) => $['operation.duplicate'])}</span>
                  </DropdownMenuItem>
                )}
                {skill.latest_published_version_id && (
                  <DropdownMenuItem className="gap-2" onClick={handleExport}>
                    <span
                      aria-hidden
                      className="i-ri-download-2-line size-4 shrink-0 text-text-tertiary"
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
                      onClick={() => setIsDeleteOpen(true)}
                    >
                      <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                      <span>{tCommon(($) => $['operation.delete'])}</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className="relative flex h-6 shrink-0 items-start px-3">
          <SkillCardTags
            skillId={skill.id}
            tags={skill.tags ?? []}
            onOpenTagManagement={onOpenTagManagement}
            onTagsChange={() => invalidateSkillListQueries(queryClient)}
          />
        </div>
        <div className="flex min-w-0 shrink-0 items-center px-4 pt-2 pb-3 system-xs-regular text-text-tertiary">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="shrink-0">
              {t(
                ($) =>
                  skill.reference_count === 1
                    ? $['skillManagement.referenceCount_one']
                    : $['skillManagement.referenceCount_other'],
                { count: skill.reference_count ?? 0 },
              )}
            </span>
            <span aria-hidden className="shrink-0 text-text-quaternary">
              ·
            </span>
            <span
              className="min-w-0 truncate"
              title={
                isDraft
                  ? t(($) => $['skillManagement.editedAt'], { time: updatedAt })
                  : t(($) => $['skillManagement.publishedAt'], { time: publishedAt })
              }
            >
              {isDraft
                ? t(($) => $['skillManagement.editedAt'], { time: updatedAt })
                : t(($) => $['skillManagement.publishedAt'], { time: publishedAt })}
            </span>
          </div>
        </div>
      </div>
      {isDraft && (
        <div className="absolute top-[-0.5px] right-0 flex h-5 items-start overflow-hidden">
          <div className="h-5 w-3 bg-background-section-burn [clip-path:polygon(0_0,100%_0,100%_100%)]" />
          <div className="flex h-5 items-center bg-background-section-burn pr-2 pl-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $['skillManagement.draft'])}
          </div>
        </div>
      )}
      <DeleteSkillDialog skill={skill} open={isDeleteOpen} onOpenChange={setIsDeleteOpen} />
    </article>
  )
}

function SkillTagFilter({ onOpenTagManagement }: { onOpenTagManagement: () => void }) {
  const [selectedTags, setSelectedTags] = useQueryState(
    skillQueryParamNames.tag,
    skillTagQueryParser,
  )
  const tagsQuery = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type: 'skill',
        },
      },
    }),
  )
  const skillTags = useMemo(
    () => (tagsQuery.data ?? []).filter((tag) => tag.type === 'skill'),
    [tagsQuery.data],
  )
  const tagIdByName = useMemo(
    () => new Map(skillTags.map((tag) => [tag.name, tag.id])),
    [skillTags],
  )
  const tagNameById = useMemo(
    () => new Map(skillTags.map((tag) => [tag.id, tag.name])),
    [skillTags],
  )
  const validSelectedTags = useMemo(
    () => selectedTags.filter((tagName) => tagIdByName.has(tagName)),
    [selectedTags, tagIdByName],
  )
  const selectedTagIds = selectedTags.flatMap((tagName) => {
    const tagId = tagIdByName.get(tagName)
    return tagId ? [tagId] : []
  })

  useEffect(() => {
    if (!tagsQuery.isSuccess || validSelectedTags.length === selectedTags.length) return

    // oxlint-disable-next-line eslint-react/set-state-in-effect -- The loaded tag list is authoritative, so remove stale names from the external URL query state.
    void setSelectedTags(validSelectedTags)
  }, [selectedTags, setSelectedTags, tagsQuery.isSuccess, validSelectedTags])

  return (
    <TagFilter
      type="skill"
      value={selectedTagIds}
      onChange={(tagIds) => {
        void setSelectedTags(
          tagIds.flatMap((tagId) => {
            const tagName = tagNameById.get(tagId)
            return tagName ? [tagName] : []
          }),
        )
      }}
      onOpenTagManagement={onOpenTagManagement}
      showLeadingIcon={false}
      triggerClassName="min-w-0"
    />
  )
}

function SkillsToolbar({
  canEdit,
  creating,
  importing,
  onCreate,
  onImport,
  onOpenTagManagement,
}: {
  canEdit: boolean
  creating: boolean
  importing: boolean
  onCreate: () => void
  onImport: () => void
  onOpenTagManagement: () => void
}) {
  const { t } = useTranslation('skill')
  const [keyword, setKeyword] = useQueryState(skillQueryParamNames.keyword, skillKeywordQueryParser)
  const isMutating = creating || importing

  return (
    <div className="flex min-w-0 items-center gap-2">
      <SkillTagFilter onOpenTagManagement={onOpenTagManagement} />
      <SearchInput
        aria-label={t(($) => $['skillManagement.searchLabel'])}
        className="h-8 w-50 min-w-0 shrink"
        placeholder={t(($) => $['skillManagement.searchPlaceholder'])}
        value={keyword}
        onValueChange={(value) => {
          void setKeyword(value)
        }}
      />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {canEdit && (
          <Button
            className="h-8 gap-1 px-3"
            disabled={isMutating}
            loading={importing}
            onClick={onImport}
          >
            <span aria-hidden className="i-ri-upload-line size-4" />
            <span className="px-0.5 system-sm-medium">{t(($) => $['skillManagement.import'])}</span>
          </Button>
        )}
        {canEdit && (
          <Button
            variant="primary"
            className="h-8 gap-0.5 px-3"
            disabled={isMutating}
            loading={creating}
            onClick={onCreate}
          >
            <span aria-hidden className="i-ri-add-line size-4" />
            <span className="px-0.5 system-sm-medium">{t(($) => $['skillManagement.create'])}</span>
          </Button>
        )}
      </div>
    </div>
  )
}

function SkillGrid({
  canDelete,
  canEdit,
  creating,
  importing,
  isEmptySearch,
  isError,
  isFetching,
  isFetchingNextPage,
  isPending,
  onCreate,
  onImport,
  onOpenTagManagement,
  skills,
}: {
  canDelete: boolean
  canEdit: boolean
  creating: boolean
  importing: boolean
  isEmptySearch: boolean
  isError: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isPending: boolean
  onCreate: () => void
  onImport: () => void
  onOpenTagManagement: () => void
  skills: SkillResponse[]
}) {
  const { t } = useTranslation('skill')

  return (
    <section
      aria-label={t(($) => $['skillManagement.listLabel'])}
      className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-2.5"
      aria-busy={isFetching || undefined}
    >
      {isPending && <SkillCardSkeleton />}
      {!isPending && isError && (
        <SkillPlaceholderState title={t(($) => $['skillManagement.loadingError'])} />
      )}
      {!isPending && !isError && skills.length === 0 && (
        <SkillPlaceholderState
          canEdit={canEdit}
          creating={creating}
          importing={importing}
          isEmptySearch={isEmptySearch}
          onCreate={onCreate}
          onImport={onImport}
          title={
            isEmptySearch
              ? t(($) => $['skillManagement.emptySearch'])
              : t(($) => $['skillManagement.empty'])
          }
        />
      )}
      {!isPending &&
        !isError &&
        skills.map((skill) => (
          <SkillCard
            key={skill.id}
            canDelete={canDelete}
            canEdit={canEdit}
            skill={skill}
            onOpenTagManagement={onOpenTagManagement}
          />
        ))}
      {!isPending && !isError && isFetchingNextPage && <SkillCardSkeleton />}
    </section>
  )
}

export default function SkillsPage() {
  const { t } = useTranslation('skill')
  const router = useRouter()
  const queryClient = useQueryClient()
  const { canDelete, canEdit } = useSkillPermissions()
  const importInputRef = useRef<HTMLInputElement>(null)
  const listViewportRef = useRef<HTMLDivElement>(null)
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const [keyword] = useQueryState(skillQueryParamNames.keyword, skillKeywordQueryParser)
  const [selectedTags] = useQueryState(skillQueryParamNames.tag, skillTagQueryParser)
  const debouncedKeyword = useDebounce(keyword.trim(), { wait: 300 })
  const createMutation = useMutation(
    consoleQuery.workspaces.current.skills.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const importMutation = useMutation(
    consoleQuery.workspaces.current.skills.import.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const skillsQuery = useInfiniteQuery({
    ...consoleQuery.workspaces.current.skills.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: SKILLS_PAGE_SIZE,
          page: Number(pageParam),
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(selectedTags.length > 0 ? { tag: selectedTags } : {}),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? (lastPage.page ?? 1) + 1 : undefined),
      initialPageParam: 1,
    }),
    refetchOnMount: 'always',
  })
  const skills = skillsQuery.data?.pages.flatMap((page) => page.data ?? []) ?? []
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = skillsQuery

  useDocumentTitle(t(($) => $['skillManagement.title']))

  const handleCreate = () => {
    if (createMutation.isPending) return

    createMutation.mutate(
      {
        body: {},
      },
      {
        onSuccess: (skill) => {
          toast.success(t(($) => $['skillManagement.createSuccess']))
          invalidateSkillListQueries(queryClient)
          router.push(`/skills/${skill.id}`)
        },
        onError: async (error) => {
          const normalizedError = await normalizeSkillError(error)
          toast.error(
            getSkillErrorCode(normalizedError) === 'skill_limit_exceeded'
              ? t(($) => $['skillManagement.errors.workspaceLimit'])
              : t(($) => $['skillManagement.createFailed']),
          )
        },
      },
    )
  }

  const handleFileChange = (file: File | undefined) => {
    if (!file || importMutation.isPending) return

    importMutation.mutate(
      {
        body: {
          file,
        },
      },
      {
        onSuccess: (skill) => {
          toast.success(t(($) => $['skillManagement.importSuccess']))
          invalidateSkillListQueries(queryClient)
          router.push(`/skills/${skill.id}`)
        },
        onError: async (error) => {
          const normalizedError = await normalizeSkillError(error)
          const errorCode = getSkillErrorCode(normalizedError)
          if (errorCode === 'skill_name_conflict') {
            toast.error(
              t(($) => $['skillManagement.errors.nameConflict'], {
                name: getSkillErrorDetailString(normalizedError, 'name') ?? '',
              }),
            )
            return
          }
          if (errorCode === 'skill_limit_exceeded') {
            toast.error(t(($) => $['skillManagement.errors.workspaceLimit']))
            return
          }
          if (errorCode === 'missing_skill_md') {
            toast.error(t(($) => $['skillManagement.errors.missingSkillMd']))
            return
          }
          toast.error(t(($) => $['skillManagement.importFailed']))
        },
        onSettled: () => {
          if (importInputRef.current) importInputRef.current.value = ''
        },
      },
    )
  }

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (scrollBottom < 80 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }

  useEffect(() => {
    const viewport = listViewportRef.current
    if (!viewport || viewport.clientHeight === 0 || isPending || isFetchingNextPage || !hasNextPage)
      return

    if (viewport.scrollHeight - viewport.clientHeight < 80) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isPending, skills.length])

  return (
    <div className="flex h-0 min-w-0 grow flex-col overflow-hidden bg-background-body">
      <div className="shrink-0 bg-background-body px-8 pt-4 pb-2">
        <div className="flex h-6 min-w-0 items-center justify-between gap-4">
          <h1
            className="min-w-0 flex-1 truncate text-[18px]/[21.6px] font-semibold text-text-primary"
            title={t(($) => $['skillManagement.title'])}
          >
            {t(($) => $['skillManagement.title'])}
          </h1>
        </div>
        <div className="mt-3.5">
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,.skill,application/zip"
            className="hidden"
            onChange={(event) => handleFileChange(event.currentTarget.files?.[0])}
          />
          <SkillsToolbar
            canEdit={canEdit}
            creating={createMutation.isPending}
            importing={importMutation.isPending}
            onCreate={handleCreate}
            onImport={() => importInputRef.current?.click()}
            onOpenTagManagement={() => setShowTagManagementModal(true)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full min-h-0 min-w-0 overflow-hidden">
          <ScrollAreaViewport
            ref={listViewportRef}
            tabIndex={-1}
            className="overscroll-contain"
            onScroll={handleListScroll}
          >
            <ScrollAreaContent className="min-h-full px-8 pt-2 pb-8">
              <SkillGrid
                canDelete={canDelete}
                canEdit={canEdit}
                creating={createMutation.isPending}
                importing={importMutation.isPending}
                skills={skills}
                isEmptySearch={!!debouncedKeyword || selectedTags.length > 0}
                isError={skillsQuery.isError}
                isFetching={skillsQuery.isFetching}
                isFetchingNextPage={skillsQuery.isFetchingNextPage}
                isPending={skillsQuery.isPending}
                onCreate={handleCreate}
                onImport={() => importInputRef.current?.click()}
                onOpenTagManagement={() => setShowTagManagementModal(true)}
              />
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
      </div>
      <SkillListTagManagementModal
        show={showTagManagementModal}
        onClose={() => setShowTagManagementModal(false)}
        onTagsChange={() => invalidateSkillListQueries(queryClient)}
      />
    </div>
  )
}
