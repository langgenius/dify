'use client'

import type { AvailableEvaluationWorkflow } from '@/types/evaluation'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useInfiniteScroll } from 'ahooks'
import * as React from 'react'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Loading from '@/app/components/base/loading'
import { useAvailableEvaluationWorkflows } from '@/service/use-evaluation'

type WorkflowSelectorProps = {
  value: string | null
  selectedWorkflowName?: string | null
  onSelect: (workflow: AvailableEvaluationWorkflow) => void
}

const PAGE_SIZE = 20

const getWorkflowName = (workflow: AvailableEvaluationWorkflow) => {
  return workflow.marked_name || workflow.app_name || workflow.id
}

const isSelectedWorkflow = (
  workflow: AvailableEvaluationWorkflow,
  value: string | null,
) => workflow.app_id === value

const WorkflowSelector = ({
  value,
  selectedWorkflowName,
  onSelect,
}: WorkflowSelectorProps) => {
  const { t } = useTranslation('evaluation')
  const [isOpen, setIsOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const deferredSearchText = useDeferredValue(searchText)
  const viewportRef = useRef<HTMLDivElement>(null)

  const keyword = deferredSearchText.trim() || undefined

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
  } = useAvailableEvaluationWorkflows(
    {
      page: 1,
      limit: PAGE_SIZE,
      keyword,
    },
    { enabled: isOpen },
  )

  const workflows = useMemo(() => {
    return (data?.pages ?? []).flatMap(page => page.items)
  }, [data?.pages])

  const currentWorkflowName = useMemo(() => {
    if (!value)
      return null

    const selectedWorkflow = workflows.find(workflow => isSelectedWorkflow(workflow, value))
    if (selectedWorkflow)
      return getWorkflowName(selectedWorkflow)

    return selectedWorkflowName ?? null
  }, [selectedWorkflowName, value, workflows])

  const isNoMore = hasNextPage === false

  useInfiniteScroll(
    async () => {
      if (!hasNextPage || isFetchingNextPage)
        return { list: [] }

      await fetchNextPage()
      return { list: [] }
    },
    {
      target: viewportRef,
      isNoMore: () => isNoMore,
      reloadDeps: [isFetchingNextPage, isNoMore, keyword],
    },
  )

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen)

    if (!nextOpen)
      setSearchText('')
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={(
          <button
            type="button"
            className="group flex w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 text-left outline-hidden hover:bg-components-input-bg-normal focus-visible:bg-components-input-bg-normal"
            aria-label={t('metrics.custom.workflowLabel')}
          >
            <div className="flex min-w-0 grow items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                <div className="flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
                  <span aria-hidden="true" className="i-ri-equalizer-2-line h-3.5 w-3.5 text-text-tertiary" />
                </div>
              </div>
              <div className="min-w-0 flex-1 px-1 py-1 text-left">
                <div className={cn(
                  'truncate system-sm-regular',
                  currentWorkflowName ? 'text-text-secondary' : 'text-components-input-text-placeholder',
                )}
                >
                  {currentWorkflowName ?? t('metrics.custom.workflowPlaceholder')}
                </div>
              </div>
            </div>
            <span className="shrink-0 px-1 text-text-quaternary transition-colors group-hover:text-text-secondary">
              <span aria-hidden="true" className="i-ri-arrow-down-s-line h-4 w-4" />
            </span>
          </button>
        )}
      />

      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-[360px] overflow-hidden p-0"
      >
        <div className="bg-components-panel-bg">
          <div className="p-2 pb-1">
            <Input
              showLeftIcon
              showClearIcon
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              onClear={() => setSearchText('')}
            />
          </div>

          {(isLoading || (isFetching && workflows.length === 0))
            ? (
                <div className="flex h-[120px] items-center justify-center">
                  <Loading type="area" />
                </div>
              )
            : !workflows.length
                ? (
                    <div className="flex h-[120px] items-center justify-center system-sm-regular text-text-tertiary">
                      {t('noData', { ns: 'common' })}
                    </div>
                  )
                : (
                    <ScrollAreaRoot className="relative max-h-[240px] overflow-hidden">
                      <ScrollAreaViewport ref={viewportRef}>
                        <ScrollAreaContent className="p-1" role="listbox" aria-label={t('metrics.custom.workflowLabel')}>
                          {workflows.map(workflow => (
                            <button
                              key={workflow.id}
                              type="button"
                              role="option"
                              aria-selected={isSelectedWorkflow(workflow, value)}
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-state-base-hover"
                              onClick={() => {
                                onSelect(workflow)
                                setIsOpen(false)
                                setSearchText('')
                              }}
                            >
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                                <div className="flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
                                  <span aria-hidden="true" className="i-ri-equalizer-2-line h-3.5 w-3.5 text-text-tertiary" />
                                </div>
                              </div>
                              <div className="min-w-0 flex-1 truncate px-1 py-1 system-sm-medium text-text-secondary">
                                {getWorkflowName(workflow)}
                              </div>
                              {isSelectedWorkflow(workflow, value) && (
                                <span aria-hidden="true" className="i-ri-check-line h-4 w-4 shrink-0 text-text-accent" />
                              )}
                            </button>
                          ))}

                          {isFetchingNextPage && (
                            <div className="flex justify-center px-3 py-2">
                              <Loading />
                            </div>
                          )}
                        </ScrollAreaContent>
                      </ScrollAreaViewport>
                      <ScrollAreaScrollbar orientation="vertical">
                        <ScrollAreaThumb />
                      </ScrollAreaScrollbar>
                    </ScrollAreaRoot>
                  )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default React.memo(WorkflowSelector)
