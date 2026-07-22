'use client'

import type { SkillResponse } from '@dify/contracts/api/console/workspaces/types.gen'
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
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useQueryState } from 'nuqs'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import useDocumentTitle from '@/hooks/use-document-title'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { skillKeywordQueryParser, skillQueryParamNames, skillTagQueryParser } from './query-params'

const placeholderCardIds = Array.from(
  { length: 16 },
  (_, index) => `skill-placeholder-card-${index}`,
)
const skeletonRows = ['primary', 'secondary', 'tertiary'] as const

function skillsListQueryKey() {
  return consoleQuery.workspaces.current.skills.get.key({ type: 'query' })
}

function SkillIcon({ icon }: { icon?: string }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-background-default-dodge">
      {icon ? (
        <span className="system-lg-medium text-text-secondary">{icon}</span>
      ) : (
        <span aria-hidden className="i-ri-box-3-line size-5 text-text-tertiary" />
      )}
    </div>
  )
}

function SkillTagBadge({ tag }: { tag: string }) {
  return (
    <span className="flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
      <span className="max-w-28 truncate">{tag}</span>
    </span>
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
  creating,
  importing,
  isEmptySearch,
  onCreate,
  onImport,
  title,
}: {
  creating?: boolean
  importing?: boolean
  isEmptySearch?: boolean
  onCreate?: () => void
  onImport?: () => void
  title: string
}) {
  const { t } = useTranslation('agentV2')

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
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-2">
        <div className="flex w-[420px] max-w-full flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-[10px]">
            <div className="flex size-full min-w-px items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md">
              <span aria-hidden className="i-ri-box-3-line size-6 text-text-tertiary" />
            </div>
          </div>
          <h2
            id="skill-placeholder-title"
            className="system-sm-regular whitespace-nowrap text-text-tertiary"
          >
            {title}
          </h2>
          {!isEmptySearch && (
            <div className="mt-2 flex w-full flex-col gap-2">
              <button
                type="button"
                disabled={creating || importing}
                className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl bg-components-card-bg px-4 text-left shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onCreate}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 text-text-tertiary',
                    creating ? 'i-ri-loader-4-line animate-spin' : 'i-ri-sparkling-2-line',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate system-sm-medium text-text-secondary">
                    {t(($) => $['skillManagement.emptyAction.createTitle'])}
                  </span>
                  <span className="block truncate system-xs-regular text-text-tertiary">
                    {t(($) => $['skillManagement.emptyAction.createDescription'])}
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={creating || importing}
                className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl bg-components-card-bg px-4 text-left shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onImport}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 text-text-tertiary',
                    importing ? 'i-ri-loader-4-line animate-spin' : 'i-ri-upload-line',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate system-sm-medium text-text-secondary">
                    {t(($) => $['skillManagement.emptyAction.importTitle'])}
                  </span>
                  <span className="block truncate system-xs-regular text-text-tertiary">
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
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const deleteMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.delete.mutationOptions(),
  )
  const referenceCount = skill.reference_count ?? 0
  const description =
    referenceCount > 0
      ? t(($) => $['skillManagement.deleteDialog.referencedDescription'], {
          count: referenceCount,
        })
      : t(($) => $['skillManagement.deleteDialog.description'])

  const handleDelete = () => {
    if (deleteMutation.isPending) return

    deleteMutation.mutate(
      {
        params: {
          skill_id: skill.id,
        },
        body: {
          confirmation_name: skill.name,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.deleteSuccess']))
          void queryClient.invalidateQueries({ queryKey: skillsListQueryKey() })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
          })
          onOpenChange(false)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.deleteFailed']))
        },
      },
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="p-6">
        <AlertDialogTitle className="truncate title-2xl-semi-bold text-text-primary">
          {t(($) => $['skillManagement.deleteDialog.title'], { name: skill.display_name })}
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-2 system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
          {description}
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
  )
}

function SkillCard({ skill }: { skill: SkillResponse }) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { formatTime } = useTimestamp()
  const queryClient = useQueryClient()
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const duplicateMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.duplicate.post.mutationOptions(),
  )
  const tags = skill.tags ?? []
  const isDraft = !skill.latest_published_version_id
  const updatedAt = formatTime(
    skill.updated_at,
    t(($) => $['skillManagement.dateTimeFormat']),
  )

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
          void queryClient.invalidateQueries({ queryKey: skillsListQueryKey() })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
          })
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.duplicateFailed']))
        },
      },
    )
  }

  return (
    <article className="group relative col-span-1 h-42 min-w-0 overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow duration-200 ease-in-out hover:shadow-lg">
      <div className="flex h-full min-w-0 flex-col">
        <Link
          href={`/skills/${skill.id}`}
          className="block min-w-0 shrink-0 cursor-pointer outline-hidden"
        >
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <SkillIcon icon={skill.icon} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
              <h2 className="truncate system-md-semibold text-text-secondary">
                {skill.display_name}
              </h2>
              <p className="truncate system-xs-regular text-text-tertiary">{skill.name}</p>
            </div>
          </div>
          <div className="px-4 py-1 system-xs-regular text-text-tertiary">
            <div className="line-clamp-2 min-h-8">{skill.description}</div>
          </div>
        </Link>
        <div className="relative h-6 shrink-0 px-3">
          {tags.length > 0 && (
            <div className="flex min-w-0 gap-1 overflow-hidden p-1">
              {tags.slice(0, 4).map((tag) => (
                <SkillTagBadge key={tag} tag={tag} />
              ))}
            </div>
          )}
          <div className="pointer-events-none absolute top-0 right-0 bottom-0 w-14 bg-linear-to-r from-components-card-bg-transparent to-components-card-bg" />
        </div>
        <div className="flex min-w-0 shrink-0 items-center px-4 pt-2 pb-3 system-xs-regular text-text-tertiary">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="shrink-0">
              {t(($) => $['skillManagement.referenceCount'], {
                count: skill.reference_count ?? 0,
              })}
            </span>
            <span aria-hidden className="shrink-0 text-text-quaternary">
              ·
            </span>
            <span className="min-w-0 truncate">
              {isDraft
                ? t(($) => $['skillManagement.editedAt'], { time: updatedAt })
                : t(($) => $['skillManagement.publishedAt'], { time: updatedAt })}
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
      <div className="pointer-events-none absolute top-2 right-2 z-20 flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 opacity-0 shadow-lg backdrop-blur-xs transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 has-data-popup-open:pointer-events-auto has-data-popup-open:opacity-100">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={t(($) => $['skillManagement.moreActions'], { name: skill.display_name })}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg p-1.5 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sr-only">
              {t(($) => $['skillManagement.moreActions'], { name: skill.display_name })}
            </span>
            <span aria-hidden className="i-ri-more-fill size-4.5 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-40">
            <DropdownMenuItem className="gap-2" onClick={handleDuplicate}>
              <span
                aria-hidden
                className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary"
              />
              <span>{tCommon(($) => $['operation.duplicate'])}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => setIsDeleteOpen(true)}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
              <span>{tCommon(($) => $['operation.delete'])}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <DeleteSkillDialog skill={skill} open={isDeleteOpen} onOpenChange={setIsDeleteOpen} />
    </article>
  )
}

function SkillTagFilter({ tags }: { tags: string[] }) {
  const { t } = useTranslation('agentV2')
  const [selectedTags, setSelectedTags] = useQueryState(
    skillQueryParamNames.tag,
    skillTagQueryParser,
  )
  const selectedTagSet = new Set(selectedTags)

  const toggleTag = (tag: string) => {
    const nextTags = selectedTagSet.has(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag]

    void setSelectedTags(nextTags)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 py-1 system-sm-regular text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
          selectedTags.length > 0 && 'text-text-secondary',
        )}
      >
        <span>{t(($) => $['skillManagement.tags'])}</span>
        {selectedTags.length > 0 && (
          <span className="flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary tabular-nums">
            {selectedTags.length}
          </span>
        )}
        <span aria-hidden className="i-ri-arrow-down-s-line size-4 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" sideOffset={4} popupClassName="w-52">
        {tags.length === 0 ? (
          <DropdownMenuItem disabled>{t(($) => $['skillManagement.noTags'])}</DropdownMenuItem>
        ) : (
          tags.map((tag) => (
            <DropdownMenuItem key={tag} className="gap-2" onClick={() => toggleTag(tag)}>
              <span
                aria-hidden
                className={cn(
                  'i-ri-check-line size-4 shrink-0',
                  selectedTagSet.has(tag) ? 'text-text-accent' : 'text-transparent',
                )}
              />
              <span className="min-w-0 flex-1 truncate">{tag}</span>
            </DropdownMenuItem>
          ))
        )}
        {selectedTags.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onClick={() => setSelectedTags([])}>
              <span aria-hidden className="i-ri-close-line size-4 shrink-0 text-text-tertiary" />
              <span>{t(($) => $['skillManagement.clearTags'])}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SkillsToolbar({
  creating,
  importing,
  onCreate,
  onImport,
  tags,
}: {
  creating: boolean
  importing: boolean
  onCreate: () => void
  onImport: () => void
  tags: string[]
}) {
  const { t } = useTranslation('agentV2')
  const [keyword, setKeyword] = useQueryState(skillQueryParamNames.keyword, skillKeywordQueryParser)
  const isMutating = creating || importing

  return (
    <div className="flex min-w-0 items-center gap-2">
      <SkillTagFilter tags={tags} />
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
        <Button
          className="h-8 gap-1 px-3"
          disabled={isMutating}
          loading={importing}
          onClick={onImport}
        >
          <span aria-hidden className="i-ri-upload-line size-4" />
          <span className="px-0.5 system-sm-medium">{t(($) => $['skillManagement.import'])}</span>
        </Button>
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
      </div>
    </div>
  )
}

function SkillGrid({
  creating,
  importing,
  isEmptySearch,
  isError,
  isFetching,
  isPending,
  onCreate,
  onImport,
  skills,
}: {
  creating: boolean
  importing: boolean
  isEmptySearch: boolean
  isError: boolean
  isFetching: boolean
  isPending: boolean
  onCreate: () => void
  onImport: () => void
  skills: SkillResponse[]
}) {
  const { t } = useTranslation('agentV2')

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
      {!isPending && !isError && skills.map((skill) => <SkillCard key={skill.id} skill={skill} />)}
    </section>
  )
}

export default function SkillsPage() {
  const { t } = useTranslation('agentV2')
  const router = useRouter()
  const queryClient = useQueryClient()
  const importInputRef = useRef<HTMLInputElement>(null)
  const [keyword] = useQueryState(skillQueryParamNames.keyword, skillKeywordQueryParser)
  const [selectedTags] = useQueryState(skillQueryParamNames.tag, skillTagQueryParser)
  const debouncedKeyword = useDebounce(keyword.trim(), { wait: 300 })
  const createMutation = useMutation(consoleQuery.workspaces.current.skills.post.mutationOptions())
  const importMutation = useMutation(
    consoleQuery.workspaces.current.skills.import.post.mutationOptions(),
  )
  const skillsQuery = useQuery(
    consoleQuery.workspaces.current.skills.get.queryOptions({
      input: {
        query: {
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(selectedTags.length > 0 ? { tag: selectedTags } : {}),
        },
      },
    }),
  )
  const tagsQuery = useQuery(consoleQuery.workspaces.current.skills.tags.get.queryOptions())
  const skills = skillsQuery.data?.data ?? []
  const tags = (tagsQuery.data?.data ?? []).map((tag) => tag.tag)

  useDocumentTitle(t(($) => $['skillManagement.title']))

  const invalidateSkills = () => {
    void queryClient.invalidateQueries({ queryKey: skillsListQueryKey() })
    void queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
    })
  }

  const handleCreate = () => {
    if (createMutation.isPending) return

    createMutation.mutate(
      {
        body: {},
      },
      {
        onSuccess: (skill) => {
          toast.success(t(($) => $['skillManagement.createSuccess']))
          invalidateSkills()
          router.push(`/skills/${skill.id}`)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.createFailed']))
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
          invalidateSkills()
          router.push(`/skills/${skill.id}`)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.importFailed']))
        },
        onSettled: () => {
          if (importInputRef.current) importInputRef.current.value = ''
        },
      },
    )
  }

  return (
    <div className="flex h-0 min-w-0 grow flex-col overflow-hidden bg-background-body">
      <div className="shrink-0 bg-background-body px-8 pt-4 pb-2">
        <div className="flex h-6 min-w-0 items-center justify-between gap-4">
          <h1 className="min-w-0 flex-1 truncate text-[18px]/[21.6px] font-semibold text-text-primary">
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
            creating={createMutation.isPending}
            importing={importMutation.isPending}
            onCreate={handleCreate}
            onImport={() => importInputRef.current?.click()}
            tags={tags}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ScrollAreaRoot className="relative h-full min-h-0 min-w-0 overflow-hidden">
          <ScrollAreaViewport tabIndex={-1} className="overscroll-contain">
            <ScrollAreaContent className="min-h-full px-8 pt-2 pb-8">
              <SkillGrid
                creating={createMutation.isPending}
                importing={importMutation.isPending}
                skills={skills}
                isEmptySearch={!!debouncedKeyword || selectedTags.length > 0}
                isError={skillsQuery.isError}
                isFetching={skillsQuery.isFetching}
                isPending={skillsQuery.isPending}
                onCreate={handleCreate}
                onImport={() => importInputRef.current?.click()}
              />
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </div>
    </div>
  )
}
