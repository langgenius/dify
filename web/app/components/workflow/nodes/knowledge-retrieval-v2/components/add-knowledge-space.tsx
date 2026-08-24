'use client'

import type { FC } from 'react'
import type { KnowledgeRetrievalV2SpaceSummary } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useInfiniteScroll } from 'ahooks'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import { toControlSpaceSummary } from '../config-helpers'

const SPACE_PAGE_SIZE = 50
const MAX_CONTROL_SPACES = 10

type Props = Readonly<{
  modal?: boolean
  onChange: (spaces: KnowledgeRetrievalV2SpaceSummary[]) => void
  selectedSpaces: KnowledgeRetrievalV2SpaceSummary[]
}>

const AddKnowledgeSpace: FC<Props> = ({ modal, onChange, selectedSpaces }) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const selectedIds = useMemo(
    () => selectedSpaces.map((space) => space.control_space_id),
    [selectedSpaces],
  )
  const [draftIds, setDraftIds] = useState(selectedIds)
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
            {t(($) => $['feature.dataSet.selectTitle'], { ns: 'appDebug' })}
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
              <Loading type="area" />
            </div>
          )}

          {!spacesQuery.isLoading && spaces.length === 0 && (
            <div className="mt-6 flex h-32 items-center justify-center rounded-lg border border-divider-subtle bg-components-panel-on-panel-item-bg text-[13px] text-text-tertiary">
              {t(($) => $['nodes.knowledgeRetrievalV2.noSpaces'], { ns: 'workflow' })}
            </div>
          )}

          {spaces.length > 0 && (
            <div ref={listRef} className="mt-7 max-h-71.5 space-y-1 overflow-y-auto">
              {spaces.map((space) => {
                const summary = toControlSpaceSummary(space)
                const selected = draftIds.includes(summary.control_space_id)
                const unavailable = space.technical_status !== 'available'
                const disabled =
                  (unavailable && !selected) || (!selected && draftIds.length >= MAX_CONTROL_SPACES)
                return (
                  <button
                    key={summary.control_space_id}
                    type="button"
                    disabled={disabled}
                    className={cn(
                      'flex h-10 w-full cursor-pointer items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 text-left shadow-xs outline-hidden hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                      selected &&
                        'border-[1.5px] border-components-option-card-option-selected-border bg-state-accent-hover hover:border-components-option-card-option-selected-border hover:bg-state-accent-hover',
                      disabled && 'cursor-default opacity-40',
                    )}
                    onClick={() => toggleSpace(summary.control_space_id)}
                  >
                    <span aria-hidden className="mr-2 shrink-0">
                      {summary.icon || '📗'}
                    </span>
                    <span className="w-0 grow truncate text-[13px] font-medium text-text-secondary">
                      {summary.name}
                    </span>
                    {unavailable && (
                      <span className="ml-1 shrink-0 rounded-md border border-divider-deep px-1 text-xs leading-4.5 text-text-tertiary">
                        {t(($) => $['nodes.knowledgeRetrievalV2.unavailable'], { ns: 'workflow' })}
                      </span>
                    )}
                  </button>
                )
              })}
              {spacesQuery.isFetchingNextPage && <Loading />}
            </div>
          )}

          {!spacesQuery.isLoading && (
            <div className="mt-8 flex items-center justify-between">
              <div className="text-sm font-medium text-text-secondary">
                {selectedDraftSpaces.length > 0 &&
                  `${selectedDraftSpaces.length} ${t(($) => $['feature.dataSet.selected'], { ns: 'appDebug' })}`}
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
