'use client'

import type { UIEvent } from 'react'
import type { SkillGridState } from './grid'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import dynamic from 'next/dynamic'
import { useQueryState } from 'nuqs'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { getSkillErrorCode, getSkillErrorDetailString } from '../error'
import { useSkillPermissions } from '../permissions'
import { SkillGrid } from './grid'
import { ImportSkillDialogForm } from './import-dialog'
import { skillKeywordQueryParser, skillQueryParamNames, skillTagQueryParser } from './query-params'
import { SkillsToolbar } from './toolbar'

const TagManagementDialog = dynamic(
  () =>
    import('@/features/tag-management/tag-management-dialog').then(
      (mod) => mod.TagManagementDialog,
    ),
  { ssr: false },
)

const SKILLS_PAGE_SIZE = 20

export default function SkillsPage() {
  const titleId = useId()
  const { t } = useTranslation(['skill'])
  const describeRequestError = useRequestErrorDescriber()
  const router = useRouter()
  const { canDelete, canEdit } = useSkillPermissions()
  const [importOpen, setImportOpen] = useState(false)
  const listViewportRef = useRef<HTMLDivElement>(null)
  const [showTagManagementDialog, setShowTagManagementDialog] = useState(false)
  const [keyword] = useQueryState(skillQueryParamNames.keyword, skillKeywordQueryParser)
  const [selectedTags] = useQueryState(skillQueryParamNames.tag, skillTagQueryParser)
  const debouncedKeyword = useDebounce(keyword.trim(), { wait: 300 })
  const createMutation = useMutation(
    consoleQuery.workspaces.current.skills.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const importMutation = useMutation(
    consoleQuery.workspaces.current.skills.import.post.mutationOptions({
      meta: { errorToast: false },
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
    if (createMutation.isPending || importMutation.isPending) return

    createMutation.mutate(
      {
        body: {},
      },
      {
        onSuccess: (skill) => {
          router.push(`/skills/${skill.id}`)
        },
        onError: (error) => {
          toast.error(
            getSkillErrorCode(error) === 'skill_limit_exceeded'
              ? t(($) => $['skillManagement.errors.workspaceLimit'])
              : describeRequestError(
                  error,
                  t(($) => $['skillManagement.createFailed']),
                ),
          )
        },
      },
    )
  }

  const handleImport = (file: File) => {
    if (!canEdit || importMutation.isPending || createMutation.isPending) return

    importMutation.mutate(
      {
        body: {
          file,
        },
      },
      {
        onSuccess: (skill) => {
          setImportOpen(false)
          router.push(`/skills/${skill.id}`)
        },
        onError: (error) => {
          const errorCode = getSkillErrorCode(error)
          if (errorCode === 'skill_name_conflict') {
            toast.error(
              t(($) => $['skillManagement.errors.nameConflict'], {
                name: getSkillErrorDetailString(error, 'name') ?? '',
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
          toast.error(
            describeRequestError(
              error,
              t(($) => $['skillManagement.importFailed']),
            ),
          )
        },
      },
    )
  }

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (
      scrollBottom < 80 &&
      hasNextPage &&
      !skillsQuery.isFetching &&
      !skillsQuery.isFetchNextPageError
    )
      void fetchNextPage()
  }

  useEffect(() => {
    const viewport = listViewportRef.current
    if (
      !viewport ||
      viewport.clientHeight === 0 ||
      isPending ||
      skillsQuery.isFetching ||
      skillsQuery.isFetchNextPageError ||
      !hasNextPage
    )
      return

    if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80)
      void fetchNextPage()
  }, [
    fetchNextPage,
    hasNextPage,
    isPending,
    skills.length,
    skillsQuery.isFetching,
    skillsQuery.isFetchNextPageError,
  ])

  const isFiltered = !!debouncedKeyword || selectedTags.length > 0
  const skillGridState: SkillGridState = isPending
    ? { status: 'pending' }
    : skillsQuery.isLoadingError || (skills.length === 0 && skillsQuery.isRefetchError)
      ? {
          status: 'error',
          isRetrying: skillsQuery.isFetching,
          onRetry: () => void skillsQuery.refetch(),
        }
      : {
          status: 'ready',
          content:
            skills.length === 0
              ? {
                  kind: 'empty',
                  emptyState: isFiltered ? 'filtered' : 'skills',
                  actions:
                    canEdit && !isFiltered
                      ? {
                          creating: createMutation.isPending,
                          importing: importMutation.isPending,
                          onCreate: handleCreate,
                          onImport: () => setImportOpen(true),
                        }
                      : undefined,
                }
              : {
                  kind: 'list',
                  skills,
                  pagination: skillsQuery.isFetchNextPageError
                    ? {
                        status: 'error',
                        isRetrying: isFetchingNextPage,
                        onRetry: () => void fetchNextPage(),
                      }
                    : isFetchingNextPage
                      ? { status: 'loading' }
                      : { status: 'none' },
                  refresh: skillsQuery.isRefetchError
                    ? {
                        status: 'error',
                        isRetrying: skillsQuery.isFetching,
                        onRetry: () => void skillsQuery.refetch(),
                      }
                    : { status: 'none' },
                  cardActions: {
                    canDelete,
                    canEdit,
                    onOpenTagManagement: () => setShowTagManagementDialog(true),
                  },
                },
          isFetching: skillsQuery.isFetching,
        }

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      ref={listViewportRef}
      tabIndex={-1}
      className="flex h-0 min-w-0 grow flex-col overflow-x-hidden overflow-y-auto overscroll-contain bg-background-body outline-hidden"
      onScroll={handleListScroll}
    >
      <div className="sticky top-0 z-10 shrink-0 bg-background-body px-8 pt-4 pb-2">
        <div className="flex h-6 min-w-0 items-center justify-between gap-4">
          <h1
            id={titleId}
            className="min-w-0 flex-1 truncate text-[18px]/[21.6px] font-semibold text-text-primary"
          >
            {t(($) => $['skillManagement.title'])}
          </h1>
        </div>
        <div className="mt-3.5">
          <SkillsToolbar
            canEdit={canEdit}
            creating={createMutation.isPending}
            importing={importMutation.isPending}
            onCreate={handleCreate}
            onImport={() => setImportOpen(true)}
            onOpenTagManagement={() => setShowTagManagementDialog(true)}
          />
        </div>
      </div>

      <div className="flex-1 px-8 pt-2 pb-8">
        <SkillGrid state={skillGridState} />
      </div>
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!importMutation.isPending) setImportOpen(open)
        }}
      >
        <DialogContent>
          <ImportSkillDialogForm importing={importMutation.isPending} onImport={handleImport} />
        </DialogContent>
      </Dialog>
      <TagManagementDialog
        type="skill"
        show={showTagManagementDialog}
        onClose={() => setShowTagManagementDialog(false)}
      />
    </div>
  )
}
