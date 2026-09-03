'use client'

import type { KnowledgeFsGoldenQuestionResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { GoldenQuestionDraft, GoldenQuestionEvidenceOption } from './types'
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
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@langgenius/dify-ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Loading from '@/app/components/base/loading'
import { consoleClient, consoleQuery } from '@/service/client'
import { useKnowledgeSpace, useKnowledgeSpacePermission } from '../space/context'
import { GoldenQuestionDialog } from './golden-question-dialog'
import { GoldenQuestionImportDialog } from './golden-question-import-dialog'
import {
  emptyGoldenQuestionDraft,
  formatQualityUpdatedAt,
  goldenQuestionPayload,
  qualityPageSize,
  visibleQualityTags,
} from './quality-model'
import { QualityRowMenuTrigger } from './quality-row-menu-trigger'

type GoldenQuestionsPanelProps = {
  actionSlot: HTMLDivElement | null
}

type GoldenQuestionDialogState =
  | { mode: 'create'; value: GoldenQuestionDraft }
  | {
      evidenceOptions: GoldenQuestionEvidenceOption[]
      id: string
      mode: 'edit'
      value: GoldenQuestionDraft
    }

function GoldenStatus({ status }: { status: 'active' | 'draft' | 'stale' }) {
  const { t } = useTranslation('knowledgeSpace')
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-md px-1.5 py-0.5 system-2xs-medium-uppercase',
        status === 'active' && 'bg-state-success-hover text-text-success',
        status === 'draft' && 'bg-state-warning-hover text-text-warning',
        status === 'stale' && 'bg-state-destructive-hover text-text-destructive',
      )}
    >
      {t(($) => $[`qualityPage.goldenStatus.${status}`])}
    </span>
  )
}

function GoldenAnnotation({ annotation }: { annotation: string }) {
  if (!annotation.trim()) return <span className="system-xs-regular text-text-tertiary">—</span>
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        render={
          <button
            type="button"
            className="block w-fit max-w-full min-w-0 truncate text-left system-xs-regular text-text-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            {annotation}
          </button>
        }
      />
      <PopoverContent placement="top" className="max-w-67 px-3 py-2">
        <p className="system-xs-regular wrap-break-word text-text-tertiary">{annotation}</p>
      </PopoverContent>
    </Popover>
  )
}

function GoldenQuestionEditorDialog({
  onOpenChange,
  open,
  session,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
  session?: GoldenQuestionDialogState
}) {
  const { t } = useTranslation('knowledgeSpace')
  const { space } = useKnowledgeSpace()
  const knowledgeSpaceId = space.control_space_id
  const queryClient = useQueryClient()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const createMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post.mutationOptions(),
  )
  const updateMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.patch.mutationOptions(),
  )

  const close = () => {
    setError(undefined)
    onOpenChange(false)
  }
  const submit = async (draft: GoldenQuestionDraft) => {
    if (!session) return
    setError(undefined)
    setSubmitting(true)
    try {
      if (session.mode === 'edit') {
        await updateMutation.mutateAsync({
          body: goldenQuestionPayload(draft),
          params: { control_space_id: knowledgeSpaceId, question_id: session.id },
        })
        toast.success(t(($) => $['qualityPage.updatedToast']))
      } else {
        await createMutation.mutateAsync({
          body: goldenQuestionPayload(draft),
          params: { control_space_id: knowledgeSpaceId },
        })
        toast.success(t(($) => $['qualityPage.createdToast']))
      }
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key({
          input: { params: { control_space_id: knowledgeSpaceId } },
          type: 'infinite',
        }),
      })
      close()
    } catch {
      setError(t(($) => $.unknownError, { ns: 'dataset' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GoldenQuestionDialog
      evidenceOptions={session?.mode === 'edit' ? session.evidenceOptions : []}
      error={error}
      initialValue={session?.value ?? emptyGoldenQuestionDraft}
      knowledgeSpaceId={knowledgeSpaceId}
      mode={session?.mode ?? 'create'}
      open={open}
      pending={submitting || createMutation.isPending || updateMutation.isPending}
      sessionKey={session?.mode === 'edit' ? session.id : 'create'}
      onOpenChange={(open) => {
        if (!open && !submitting) close()
      }}
      onSubmit={submit}
    />
  )
}

export function GoldenQuestionsPanel({ actionSlot }: GoldenQuestionsPanelProps) {
  const { i18n, t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const { space } = useKnowledgeSpace()
  const canEdit = useKnowledgeSpacePermission('knowledge_space_edit')
  const knowledgeSpaceId = space.control_space_id
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [deleteIds, setDeleteIds] = useState<Set<string>>()
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [dialog, setDialog] = useState<GoldenQuestionDialogState>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const queryOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.infiniteOptions({
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: qualityPageSize,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
    })
  const query = useInfiniteQuery(queryOptions)
  const deleteMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.delete.mutationOptions(),
  )
  const items = query.data?.pages.flatMap((page) => page.data) ?? []
  const allSelected = items.length > 0 && selected.size === items.length
  const partiallySelected = selected.size > 0 && !allSelected

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey })
  const openCreate = () => {
    setDialog({
      mode: 'create',
      value: emptyGoldenQuestionDraft,
    })
    setDialogOpen(true)
  }
  const openEdit = async (item: KnowledgeFsGoldenQuestionResponse) => {
    const expectedEvidenceIds = item.expected_evidence_ids ?? []
    const value: GoldenQuestionDraft = {
      annotation: item.annotation,
      expectedEvidenceIds,
      matchPolicy: item.match_policy ?? 'all',
      question: item.question,
      tags: item.tags,
    }
    setDialog({ evidenceOptions: [], id: item.id, mode: 'edit', value })
    setDialogOpen(true)
    if (expectedEvidenceIds.length === 0) return
    const evidenceOptions =
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.evidenceMatches
        .post({
          body: { node_ids: expectedEvidenceIds },
          params: { control_space_id: knowledgeSpaceId },
        })
        .catch(() => undefined)
    setDialog((current) => {
      if (current?.mode !== 'edit' || current.id !== item.id) return current
      return { ...current, evidenceOptions: evidenceOptions?.candidates ?? [] }
    })
  }
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
  const toggleOne = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const deleteGolden = async (ids: Set<string>): Promise<boolean> => {
    setDeleteSubmitting(true)
    try {
      const results = await Promise.allSettled(
        [...ids].map((questionId) =>
          deleteMutation
            .mutateAsync({
              params: { control_space_id: knowledgeSpaceId, question_id: questionId },
            })
            .then(() => questionId),
        ),
      )
      const deletedIds = new Set(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      )
      const failedIds = new Set([...ids].filter((id) => !deletedIds.has(id)))
      setSelected((current) => new Set([...current].filter((id) => !deletedIds.has(id))))
      await invalidate().catch(() => undefined)
      if (failedIds.size > 0) {
        setDeleteIds(failedIds)
        toast.error(t(($) => $.unknownError, { ns: 'dataset' }))
        return false
      }
      toast.success(
        t(
          ($) =>
            $[ids.size === 1 ? 'qualityPage.deletedToast_one' : 'qualityPage.deletedToast_other'],
          { count: ids.size },
        ),
      )
      setDeleteIds(undefined)
      return true
    } catch {
      toast.error(t(($) => $.unknownError, { ns: 'dataset' }))
      return false
    } finally {
      setDeleteSubmitting(false)
    }
  }

  return (
    <>
      {actionSlot &&
        canEdit &&
        items.length > 0 &&
        createPortal(
          <>
            <Button className="gap-1" onClick={() => setImportOpen(true)}>
              <span aria-hidden className="i-ri-download-line size-4" />
              {t(($) => $['qualityPage.importCsv'])}
            </Button>
            <Button variant="primary" className="gap-1" onClick={openCreate}>
              <span aria-hidden className="i-ri-add-line size-4" />
              {t(($) => $['qualityPage.addGolden'])}
            </Button>
          </>,
          actionSlot,
        )}

      {query.isLoading ? (
        <div className="flex min-h-105 items-center justify-center">
          <Loading />
        </div>
      ) : query.isError ? (
        <div className="flex min-h-105 flex-col items-center justify-center gap-3 text-center">
          <span aria-hidden className="i-ri-error-warning-line size-8 text-text-warning" />
          <p role="alert" className="system-sm-medium text-text-primary">
            {t(($) => $.unknownError, { ns: 'dataset' })}
          </p>
          <Button onClick={() => void query.refetch()}>
            {t(($) => $.retry, { ns: 'dataset' })}
          </Button>
        </div>
      ) : items.length ? (
        <div className="mt-2.5 w-full overflow-x-auto pt-3">
          <div className="grid min-w-195 grid-cols-[16px_minmax(180px,2fr)_90px_minmax(120px,1fr)_minmax(160px,1.5fr)_minmax(100px,0.75fr)_32px] items-center gap-3 py-2.5 text-[11px] leading-4 font-medium text-text-tertiary">
            <Checkbox
              aria-label={t(($) => $['qualityPage.selectAll'])}
              checked={allSelected}
              disabled={!canEdit}
              indeterminate={partiallySelected}
              onCheckedChange={toggleAll}
            />
            <span>{t(($) => $['qualityPage.question'])}</span>
            <span>{t(($) => $['qualityPage.statusLabel'])}</span>
            <span>{t(($) => $['qualityPage.tags'])}</span>
            <span>{t(($) => $['qualityPage.annotation'])}</span>
            <span>{t(($) => $['qualityPage.updated'])}</span>
            <span />
          </div>
          {items.map((item) => (
            <div
              key={item.id}
              className="grid h-12 min-w-195 grid-cols-[16px_minmax(180px,2fr)_90px_minmax(120px,1fr)_minmax(160px,1.5fr)_minmax(100px,0.75fr)_32px] items-center gap-3 border-t border-divider-subtle"
            >
              <Checkbox
                aria-label={t(($) => $['qualityPage.selectQuestion'], {
                  question: item.question,
                })}
                checked={selected.has(item.id)}
                disabled={!canEdit}
                onCheckedChange={() => toggleOne(item.id)}
              />
              <span className="truncate system-sm-medium text-text-primary">
                {item.question ?? ''}
              </span>
              <GoldenStatus
                status={
                  item.status ??
                  ((item.expected_evidence_ids?.length ?? 0) > 0 ? 'active' : 'draft')
                }
              />
              <div className="flex min-w-0 gap-1 overflow-hidden">
                {visibleQualityTags(item.tags).map((tag) => (
                  <Badge key={tag} size="xs" variant="dimm" className="max-w-full min-w-0">
                    <span className="min-w-0 truncate system-2xs-medium normal-case">{tag}</span>
                  </Badge>
                ))}
              </div>
              <GoldenAnnotation annotation={item.annotation} />
              <span className="system-xs-regular text-text-secondary">
                {formatQualityUpdatedAt(item.updated_at, i18n.language)}
              </span>
              {canEdit ? (
                <DropdownMenu modal={false}>
                  <QualityRowMenuTrigger
                    label={t(($) => $['qualityPage.questionActions'], {
                      question: item.question,
                    })}
                  />
                  <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-50">
                    <DropdownMenuItem className="gap-2 px-3" onClick={() => void openEdit(item)}>
                      <span aria-hidden className="i-ri-edit-line size-4" />
                      {t(($) => $['qualityPage.edit'])}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      className="gap-2 px-3"
                      onClick={() => setDeleteIds(new Set([item.id]))}
                    >
                      <span aria-hidden className="i-ri-delete-bin-line size-4" />
                      {t(($) => $['qualityPage.delete'])}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span />
              )}
            </div>
          ))}
          {query.hasNextPage && (
            <div className="flex min-w-195 justify-center border-t border-divider-subtle py-4">
              <Button
                loading={query.isFetchingNextPage}
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {t(($) => $.loadMore)}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2.5 flex h-140 flex-col items-center justify-center text-center">
          <span aria-hidden className="i-ri-thumb-up-line size-7 text-text-tertiary" />
          <h2 className="mt-3 system-md-semibold text-text-primary">
            {t(($) => $['qualityPage.goldenEmptyTitle'])}
          </h2>
          <p className="mt-1 max-w-lg system-xs-regular text-text-tertiary">
            {t(($) => $['qualityPage.goldenEmptyDescription'])}
          </p>
          {canEdit && (
            <div className="mt-4 flex gap-2">
              <Button className="gap-1" onClick={() => setImportOpen(true)}>
                <span aria-hidden className="i-ri-download-line size-4" />
                {t(($) => $['qualityPage.importCsv'])}
              </Button>
              <Button variant="primary" className="gap-1" onClick={openCreate}>
                <span aria-hidden className="i-ri-add-line size-4" />
                {t(($) => $['qualityPage.addGolden'])}
              </Button>
            </div>
          )}
        </div>
      )}

      {canEdit && selected.size > 0 && (
        <div className="fixed bottom-6 left-[calc(50%+var(--new-rag-sidebar-width)/2)] flex h-12 -translate-x-1/2 items-center gap-2 rounded-xl border border-components-panel-border bg-components-panel-bg px-3 shadow-xl">
          <span className="system-sm-medium text-text-primary">
            {t(
              ($) =>
                $[
                  selected.size === 1
                    ? 'qualityPage.selectedCount_one'
                    : 'qualityPage.selectedCount_other'
                ],
              { count: selected.size },
            )}
          </span>
          <span aria-hidden className="h-5 w-px bg-divider-regular" />
          <Button
            variant="secondary"
            tone="destructive"
            onClick={() => setDeleteIds(new Set(selected))}
          >
            {t(($) => $['qualityPage.deleteEllipsis'])}
          </Button>
          <button
            type="button"
            aria-label={t(($) => $['qualityPage.clearSelection'])}
            className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setSelected(new Set())}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      )}

      <GoldenQuestionEditorDialog open={dialogOpen} session={dialog} onOpenChange={setDialogOpen} />
      <GoldenQuestionImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <AlertDialog
        open={Boolean(deleteIds)}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) setDeleteIds(undefined)
        }}
      >
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
            <AlertDialogCancelButton variant="secondary" disabled={deleteSubmitting}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              loading={deleteSubmitting}
              disabled={deleteSubmitting}
              onClick={() => {
                if (deleteIds) void deleteGolden(deleteIds)
              }}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
