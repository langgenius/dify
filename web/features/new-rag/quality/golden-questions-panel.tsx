'use client'

import type { KnowledgeFsGoldenQuestionResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { GoldenQuestionDraft } from './types'
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
import { consoleQuery } from '@/service/client'
import { GoldenQuestionDialog } from './golden-question-dialog'
import { GoldenQuestionImportDialog } from './golden-question-import-dialog'
import {
  emptyGoldenQuestionDraft,
  formatQualityUpdatedAt,
  goldenQuestionPayload,
  qualityPageSize,
  visibleQualityTags,
} from './quality-model'
import { QualityQueryState } from './quality-query-state'
import { QualityRowMenuTrigger } from './quality-row-menu-trigger'

type GoldenQuestionsPanelProps = {
  actionSlot: HTMLDivElement | null
  canEdit: boolean
  knowledgeSpaceId: string
}

type GoldenQuestionDialogState =
  | { key: string; mode: 'create'; value: GoldenQuestionDraft }
  | { id: string; key: string; mode: 'edit'; value: GoldenQuestionDraft }

function GoldenStatus({ status }: { status: 'active' | 'draft' | 'stale' }) {
  const { t } = useTranslation('dataset')
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-md px-1.5 py-0.5 system-2xs-medium-uppercase',
        status === 'active' && 'bg-state-success-hover text-text-success',
        status === 'draft' && 'bg-state-warning-hover text-text-warning',
        status === 'stale' && 'bg-state-destructive-hover text-text-destructive',
      )}
    >
      {t(($) => $[`newKnowledge.qualityPage.goldenStatus.${status}`])}
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

export function GoldenQuestionsPanel({
  actionSlot,
  canEdit,
  knowledgeSpaceId,
}: GoldenQuestionsPanelProps) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [deleteIds, setDeleteIds] = useState<Set<string>>()
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [dialog, setDialog] = useState<GoldenQuestionDialogState>()
  const [dialogError, setDialogError] = useState<string>()
  const [dialogSubmitting, setDialogSubmitting] = useState(false)
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
  const createMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post.mutationOptions(),
  )
  const updateMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.patch.mutationOptions(),
  )
  const deleteMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.delete.mutationOptions(),
  )
  const items = query.data?.pages.flatMap((page) => page.data) ?? []
  const allSelected = items.length > 0 && selected.size === items.length
  const partiallySelected = selected.size > 0 && !allSelected

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey })
  const openCreate = () =>
    setDialog({
      key: `create-${Date.now()}`,
      mode: 'create',
      value: emptyGoldenQuestionDraft,
    })
  const openEdit = (item: KnowledgeFsGoldenQuestionResponse) =>
    setDialog({
      id: item.id,
      key: `edit-${item.id}-${Date.now()}`,
      mode: 'edit',
      value: {
        annotation: item.annotation,
        expectedEvidenceIds: item.expected_evidence_ids ?? [],
        matchPolicy: item.match_policy ?? 'all',
        question: item.question,
        tags: item.tags,
      },
    })
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
  const toggleOne = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submitDialog = async (draft: GoldenQuestionDraft) => {
    if (!dialog) return
    setDialogError(undefined)
    setDialogSubmitting(true)
    try {
      if (dialog.mode === 'edit') {
        await updateMutation.mutateAsync({
          body: goldenQuestionPayload(draft),
          params: { control_space_id: knowledgeSpaceId, question_id: dialog.id },
        })
        toast.success(t(($) => $['newKnowledge.qualityPage.updatedToast']))
      } else {
        await createMutation.mutateAsync({
          body: goldenQuestionPayload(draft),
          params: { control_space_id: knowledgeSpaceId },
        })
        toast.success(t(($) => $['newKnowledge.qualityPage.createdToast']))
      }
      await invalidate()
      setDialog(undefined)
    } catch {
      setDialogError(t(($) => $.unknownError))
    } finally {
      setDialogSubmitting(false)
    }
  }

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
        toast.error(t(($) => $.unknownError))
        return false
      }
      toast.success(
        t(
          ($) =>
            $[
              ids.size === 1
                ? 'newKnowledge.qualityPage.deletedToast_one'
                : 'newKnowledge.qualityPage.deletedToast_other'
            ],
          { count: ids.size },
        ),
      )
      setDeleteIds(undefined)
      return true
    } catch {
      toast.error(t(($) => $.unknownError))
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
              {t(($) => $['newKnowledge.qualityPage.importCsv'])}
            </Button>
            <Button variant="primary" className="gap-1" onClick={openCreate}>
              <span aria-hidden className="i-ri-add-line size-4" />
              {t(($) => $['newKnowledge.qualityPage.addGolden'])}
            </Button>
          </>,
          actionSlot,
        )}

      <QualityQueryState
        error={query.isError}
        loading={query.isLoading}
        onRetry={() => void query.refetch()}
      >
        {items.length ? (
          <div className="mt-2.5 w-full overflow-x-auto pt-3">
            <div className="grid min-w-195 grid-cols-[16px_minmax(180px,2fr)_90px_minmax(120px,1fr)_minmax(160px,1.5fr)_minmax(100px,0.75fr)_32px] items-center gap-3 py-2.5 text-[11px] leading-4 font-medium text-text-tertiary">
              <Checkbox
                aria-label={t(($) => $['newKnowledge.qualityPage.selectAll'])}
                checked={allSelected}
                disabled={!canEdit}
                indeterminate={partiallySelected}
                onCheckedChange={toggleAll}
              />
              <span>{t(($) => $['newKnowledge.qualityPage.question'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.statusLabel'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.tags'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.annotation'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.updated'])}</span>
              <span />
            </div>
            {items.map((item) => (
              <div
                key={item.id}
                className="grid h-12 min-w-195 grid-cols-[16px_minmax(180px,2fr)_90px_minmax(120px,1fr)_minmax(160px,1.5fr)_minmax(100px,0.75fr)_32px] items-center gap-3 border-t border-divider-subtle"
              >
                <Checkbox
                  aria-label={t(($) => $['newKnowledge.qualityPage.selectQuestion'], {
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
                  {formatQualityUpdatedAt(item.updated_at)}
                </span>
                {canEdit ? (
                  <DropdownMenu modal={false}>
                    <QualityRowMenuTrigger
                      label={t(($) => $['newKnowledge.qualityPage.questionActions'], {
                        question: item.question,
                      })}
                    />
                    <DropdownMenuContent
                      placement="bottom-end"
                      sideOffset={4}
                      className="w-[200px]"
                    >
                      <DropdownMenuItem className="gap-2 px-3" onClick={() => openEdit(item)}>
                        <span aria-hidden className="i-ri-edit-line size-4" />
                        {t(($) => $['newKnowledge.qualityPage.edit'])}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        className="gap-2 px-3"
                        onClick={() => setDeleteIds(new Set([item.id]))}
                      >
                        <span aria-hidden className="i-ri-delete-bin-line size-4" />
                        {t(($) => $['newKnowledge.qualityPage.delete'])}
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
                  {t(($) => $['newKnowledge.loadMore'])}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2.5 flex h-140 flex-col items-center justify-center text-center">
            <span aria-hidden className="i-ri-thumb-up-line size-7 text-text-tertiary" />
            <h2 className="mt-3 system-md-semibold text-text-primary">
              {t(($) => $['newKnowledge.qualityPage.goldenEmptyTitle'])}
            </h2>
            <p className="mt-1 max-w-lg system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.qualityPage.goldenEmptyDescription'])}
            </p>
            {canEdit && (
              <div className="mt-4 flex gap-2">
                <Button className="gap-1" onClick={() => setImportOpen(true)}>
                  <span aria-hidden className="i-ri-download-line size-4" />
                  {t(($) => $['newKnowledge.qualityPage.importCsv'])}
                </Button>
                <Button variant="primary" className="gap-1" onClick={openCreate}>
                  <span aria-hidden className="i-ri-add-line size-4" />
                  {t(($) => $['newKnowledge.qualityPage.addGolden'])}
                </Button>
              </div>
            )}
          </div>
        )}
      </QualityQueryState>

      {canEdit && selected.size > 0 && (
        <div className="fixed bottom-6 left-[calc(50%+var(--new-rag-sidebar-width)/2)] flex h-12 -translate-x-1/2 items-center gap-2 rounded-xl border border-components-panel-border bg-components-panel-bg px-3 shadow-xl">
          <span className="system-sm-medium text-text-primary">
            {t(
              ($) =>
                $[
                  selected.size === 1
                    ? 'newKnowledge.qualityPage.selectedCount_one'
                    : 'newKnowledge.qualityPage.selectedCount_other'
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
            {t(($) => $['newKnowledge.qualityPage.deleteEllipsis'])}
          </Button>
          <button
            type="button"
            aria-label={t(($) => $['newKnowledge.qualityPage.clearSelection'])}
            className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setSelected(new Set())}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      )}

      {dialog && (
        <GoldenQuestionDialog
          key={dialog.key}
          initialValue={dialog.value}
          knowledgeSpaceId={knowledgeSpaceId}
          mode={dialog.mode}
          open
          error={dialogError}
          pending={
            dialogSubmitting ||
            createMutation.isPending ||
            updateMutation.isPending ||
            deleteMutation.isPending
          }
          onOpenChange={(open) => {
            if (!open) {
              setDialog(undefined)
              setDialogError(undefined)
            }
          }}
          onSubmit={submitDialog}
        />
      )}
      {importOpen && (
        <GoldenQuestionImportDialog
          knowledgeSpaceId={knowledgeSpaceId}
          open
          onImported={invalidate}
          onOpenChange={setImportOpen}
        />
      )}
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
