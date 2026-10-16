'use client'

import type { FC } from 'react'
import type { KnowledgeRetrievalV2SpaceSummary } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useInfiniteScroll } from 'ahooks'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { consoleQuery } from '@/service/console'
import { canBindControlSpace, toControlSpaceSummary } from '../config-helpers'

const SPACE_PAGE_SIZE = 50
const MAX_CONTROL_SPACES = 10

type Props = Readonly<{
  modal?: boolean
  onChange: (spaces: KnowledgeRetrievalV2SpaceSummary[]) => void
  selectedSpaces: KnowledgeRetrievalV2SpaceSummary[]
}>

const AddKnowledgeSpace: FC<Props> = ({ modal, onChange, selectedSpaces }) => {
  const { t } = useTranslation(['common', 'workflow'])
  const [isOpen, setIsOpen] = useState(false)
  const selectedIds = useMemo(
    () => selectedSpaces.map((space) => space.control_space_id),
    [selectedSpaces],
  )
  const [draftIds, setDraftIds] = useState(selectedIds)
  const baseId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const spacesQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({ query: { limit: SPACE_PAGE_SIZE, page: pageParam } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
    enabled: isOpen,
  })
  const spaces = useMemo(
    () => spacesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [spacesQuery.data?.pages],
  )
  const summaryMap = useMemo(
    () =>
      new Map([
        ...selectedSpaces.map((space) => [space.control_space_id, space] as const),
        ...spaces.map((space) => {
          const summary = toControlSpaceSummary(space)
          return [summary.control_space_id, summary] as const
        }),
      ]),
    [selectedSpaces, spaces],
  )
  const selectedDraftSpaces = useMemo(
    () =>
      draftIds.map(
        (controlSpaceId) =>
          summaryMap.get(controlSpaceId) ?? {
            control_space_id: controlSpaceId,
            name: controlSpaceId,
          },
      ),
    [draftIds, summaryMap],
  )

  useInfiniteScroll(
    async () => {
      if (!spacesQuery.hasNextPage || spacesQuery.isFetchingNextPage) return { list: [] }
      await spacesQuery.fetchNextPage()
      return { list: [] }
    },
    {
      target: listRef,
      isNoMore: () => spacesQuery.hasNextPage === false,
      reloadDeps: [spacesQuery.hasNextPage, spacesQuery.isFetchingNextPage],
    },
  )

  const close = useCallback(() => {
    setDraftIds(selectedIds)
    setIsOpen(false)
  }, [selectedIds])

  const toggleSpace = useCallback((controlSpaceId: string) => {
    setDraftIds((current) => {
      if (current.includes(controlSpaceId)) return current.filter((id) => id !== controlSpaceId)
      if (current.length >= MAX_CONTROL_SPACES) return current
      return [...current, controlSpaceId]
    })
  }, [])

  const confirm = useCallback(() => {
    onChange(selectedDraftSpaces)
    setIsOpen(false)
  }, [onChange, selectedDraftSpaces])

  return (
    <>
      <button
        type="button"
        aria-label={`${t(($) => $['operation.add'], { ns: 'common' })} ${t(($) => $['nodes.knowledgeRetrievalV2.knowledgeSpaces'], { ns: 'workflow' })}`}
        className="cursor-pointer rounded-md border-none bg-transparent p-1 outline-hidden select-none hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={() => {
          setDraftIds(selectedIds)
          setIsOpen(true)
        }}
      >
        <span aria-hidden className="i-ri-add-line size-4 text-text-tertiary" />
      </button>
      <Dialog
        modal={modal}
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent backdropProps={{ forceRender: true }} className="w-100 overflow-hidden">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['nodes.knowledgeRetrievalV2.selectTitle'], { ns: 'workflow' })}
          </DialogTitle>
          <DialogClose
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                className="absolute top-4 right-4"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />

          {spacesQuery.isLoading && spaces.length === 0 && (
            <div className="flex h-50">
              <LoadingPlaceholder />
            </div>
          )}

          {spacesQuery.isError && spaces.length === 0 && (
            <div
              role="alert"
              className="mt-6 flex flex-col items-center justify-center gap-2 rounded-lg border border-divider-subtle bg-components-panel-on-panel-item-bg p-4 text-center text-[13px] text-text-destructive"
            >
              <p>{t(($) => $['nodes.knowledgeRetrievalV2.loadSpacesError'], { ns: 'workflow' })}</p>
              <Button
                size="small"
                loading={spacesQuery.isFetching}
                onClick={() => void spacesQuery.refetch()}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </div>
          )}

          {spacesQuery.isSuccess && spaces.length === 0 && (
            <div className="mt-6 flex h-32 items-center justify-center rounded-lg border border-divider-subtle bg-components-panel-on-panel-item-bg text-[13px] text-text-tertiary">
              {t(($) => $['nodes.knowledgeRetrievalV2.noSpaces'], { ns: 'workflow' })}
            </div>
          )}

          {spaces.length > 0 && (
            <div ref={listRef} className="mt-7 max-h-71.5 overflow-y-auto">
              <fieldset className="min-w-0 space-y-1">
                <legend className="sr-only">
                  {t(($) => $['nodes.knowledgeRetrievalV2.selectTitle'], { ns: 'workflow' })}
                </legend>
                {spaces.map((space) => {
                  const summary = toControlSpaceSummary(space)
                  const selected = draftIds.includes(summary.control_space_id)
                  const unavailable = !canBindControlSpace(space)
                  // An existing ineligible selection stays enabled so it can be removed.
                  const disabled =
                    !selected && (unavailable || draftIds.length >= MAX_CONTROL_SPACES)
                  const rowId = `${baseId}-${summary.control_space_id}`
                  return (
                    <label
                      key={summary.control_space_id}
                      htmlFor={rowId}
                      className={cn(
                        'flex h-10 w-full items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 shadow-xs hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
                        selected &&
                          'border-[1.5px] border-components-option-card-option-selected-border bg-state-accent-hover hover:border-components-option-card-option-selected-border hover:bg-state-accent-hover',
                        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                      )}
                    >
                      <span aria-hidden className="mr-2 shrink-0">
                        {summary.icon || '📗'}
                      </span>
                      <span
                        id={`${rowId}-name`}
                        className="w-0 grow truncate text-[13px] font-medium text-text-secondary"
                      >
                        {summary.name}
                      </span>
                      {unavailable && (
                        <span
                          id={`${rowId}-status`}
                          className="ml-1 shrink-0 rounded-md border border-divider-deep px-1 text-xs leading-4.5 text-text-tertiary"
                        >
                          {t(($) => $['nodes.knowledgeRetrievalV2.unavailable'], {
                            ns: 'workflow',
                          })}
                        </span>
                      )}
                      <Checkbox
                        id={rowId}
                        className="ml-2 shrink-0"
                        aria-labelledby={`${rowId}-name`}
                        aria-describedby={unavailable ? `${rowId}-status` : undefined}
                        checked={selected}
                        disabled={disabled}
                        onCheckedChange={() => toggleSpace(summary.control_space_id)}
                      />
                    </label>
                  )
                })}
              </fieldset>
              {spacesQuery.isFetchingNextPage && <LoadingPlaceholder />}
              {spacesQuery.isFetchNextPageError && !spacesQuery.isFetchingNextPage && (
                <div
                  role="alert"
                  className="mt-2 flex items-center justify-between gap-2 px-2 text-[13px] text-text-destructive"
                >
                  <p>
                    {t(($) => $['nodes.knowledgeRetrievalV2.loadSpacesError'], { ns: 'workflow' })}
                  </p>
                  <Button size="small" onClick={() => void spacesQuery.fetchNextPage()}>
                    {t(($) => $['operation.retry'], { ns: 'common' })}
                  </Button>
                </div>
              )}
            </div>
          )}

          {!spacesQuery.isLoading && (
            <div className="mt-8 flex items-center justify-between">
              <div className="text-sm font-medium text-text-secondary">
                {selectedDraftSpaces.length > 0 &&
                  t(($) => $['nodes.knowledgeRetrievalV2.selectedCount'], {
                    ns: 'workflow',
                    count: selectedDraftSpaces.length,
                  })}
              </div>
              <div className="flex space-x-2">
                <Button onClick={close}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
                <Button variant="primary" onClick={confirm} disabled={spaces.length === 0}>
                  {t(($) => $['operation.add'], { ns: 'common' })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default AddKnowledgeSpace
