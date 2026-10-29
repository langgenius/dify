'use client'

import type {
  KnowledgeFsSpaceListItemResponse,
  KnowledgeFsTechnicalSummary,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RefObject } from 'react'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxList,
  ComboboxStatus,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useKnowledgeValidationMessage,
  validateKnowledgeRetrievals,
} from '@/features/agent-v2/agent-composer/knowledge-validation'
import { consoleQuery } from '@/service/console'

type Props = {
  open: boolean
  initialBindings: AgentKnowledgeRetrievalItem[]
  onConfirm: (bindings: AgentKnowledgeRetrievalItem[]) => void
  onOpenChange: (open: boolean) => void
}

type FormProps = Omit<Props, 'open' | 'onOpenChange'> & {
  filterRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}

const canBindSpace = (space: KnowledgeFsSpaceListItemResponse) =>
  space.state === 'active' &&
  space.technical_status === 'available' &&
  space.permission_keys.includes('knowledge_space_read') &&
  space.permission_keys.includes('knowledge_space_query')

type SpaceOption = {
  id: string
  name: string
  description?: KnowledgeFsTechnicalSummary['description']
  unavailable: boolean
}

function KnowledgeSpaceOptionItem({
  option,
  disabled,
}: {
  option: SpaceOption
  disabled: boolean
}) {
  const { t } = useTranslation(['agentV2'])
  const description = option.unavailable
    ? t(($) => $['agentDetail.configure.knowledgeFs.unavailable'])
    : option.description

  return (
    <ComboboxItem<string>
      value={option.id}
      disabled={disabled}
      className="group/space min-h-12 gap-3"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-panel-on-panel-item-bg shadow-xs',
            option.unavailable ? 'text-text-warning' : 'text-text-tertiary',
          )}
        >
          <span
            className={cn(
              'size-4',
              option.unavailable ? 'i-ri-error-warning-line' : 'i-ri-book-open-line',
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <ComboboxItemText className="block">{option.name}</ComboboxItemText>
          {!!description && (
            <span
              className={cn(
                'block truncate system-xs-regular',
                option.unavailable ? 'text-text-warning' : 'text-text-tertiary',
              )}
            >
              {description}
            </span>
          )}
        </span>
      </span>
      <span
        aria-hidden
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-components-checkbox-border bg-components-checkbox-bg-unchecked text-components-checkbox-icon shadow-xs shadow-shadow-shadow-3 group-data-disabled/space:border-components-checkbox-border-disabled group-data-disabled/space:bg-components-checkbox-bg-disabled group-data-selected/space:border-transparent group-data-selected/space:bg-components-checkbox-bg"
      >
        <ComboboxItemIndicator className="ms-0 text-components-checkbox-icon">
          <span className="i-ri-check-line size-3" />
        </ComboboxItemIndicator>
      </span>
    </ComboboxItem>
  )
}

/** Draft state lives as long as the dialog content: each opening starts from the saved bindings. */
function AgentKnowledgeRetrievalForm({
  initialBindings,
  onConfirm,
  onClose,
  filterRef,
}: FormProps) {
  const { t } = useTranslation(['agentV2'])
  const { t: tc } = useTranslation(['common'])
  const [draft, setDraft] = useState(initialBindings)
  const [submitted, setSubmitted] = useState(false)
  const validationMessage = useKnowledgeValidationMessage()
  const spacesQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  })
  const spaces = useMemo(
    () => spacesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [spacesQuery.data],
  )
  const spacesById = useMemo(
    () => new Map(spaces.map((space) => [space.control_space_id, space])),
    [spaces],
  )
  // A later catalog page may contain a saved binding; absence is conclusive only
  // after a successful, complete listing. Never discard a binding on query refresh.
  const catalogComplete = spacesQuery.isSuccess && !spacesQuery.hasNextPage
  const unavailableBindingIds = useMemo(
    () =>
      new Set(
        draft
          .filter((item) => {
            if (!item.controlSpaceId) return false
            const space = spacesById.get(item.controlSpaceId)
            return space ? !canBindSpace(space) : catalogComplete
          })
          .map((item) => item.id),
      ),
    [catalogComplete, draft, spacesById],
  )
  const fallbackName = t(($) => $['agentDetail.configure.knowledgeFs.title'])
  const spaceName = (space?: KnowledgeFsSpaceListItemResponse) =>
    space?.technical_summary?.name || fallbackName
  // Unavailable bindings stay listed as selected options, so deselecting one is how it is removed.
  const optionItems = useMemo(() => {
    const options = new Map<string, SpaceOption>()
    for (const space of spaces) {
      if (!canBindSpace(space)) continue
      options.set(space.control_space_id, {
        id: space.control_space_id,
        name: space.technical_summary?.name || fallbackName,
        description: space.technical_summary?.description,
        unavailable: false,
      })
    }
    for (const item of draft) {
      if (!item.controlSpaceId || !unavailableBindingIds.has(item.id)) continue
      if (options.has(item.controlSpaceId)) continue
      options.set(item.controlSpaceId, {
        id: item.controlSpaceId,
        name:
          item.name || spacesById.get(item.controlSpaceId)?.technical_summary?.name || fallbackName,
        unavailable: true,
      })
    }
    return createComboboxItems([...options.values()], {
      getValue: (option) => option.id,
      getLabel: (option) => option.name,
    })
  }, [draft, fallbackName, spaces, spacesById, unavailableBindingIds])
  const selectedIds = useMemo(
    () => [
      ...new Set(
        draft.flatMap((item) =>
          item.controlSpaceId && (!item.isMissing || unavailableBindingIds.has(item.id))
            ? [item.controlSpaceId]
            : [],
        ),
      ),
    ],
    [draft, unavailableBindingIds],
  )
  const validation = validateKnowledgeRetrievals(draft)
  const spaceCount = draft.filter((item) => item.controlSpaceId).length
  const update = (id: string, patch: Partial<AgentKnowledgeRetrievalItem>) =>
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const select = (nextIds: string[]) => {
    const removed = new Set(selectedIds.filter((id) => !nextIds.includes(id)))
    const added = nextIds.filter((id) => !selectedIds.includes(id))
    setDraft((current) => {
      const next = current
        .filter((item) => !item.controlSpaceId || !removed.has(item.controlSpaceId))
        .map((item) =>
          item.controlSpaceId && item.isMissing && added.includes(item.controlSpaceId)
            ? { ...item, isMissing: false }
            : item,
        )
      for (const id of added) {
        const space = spacesById.get(id)
        if (!space || !canBindSpace(space) || next.some((item) => item.controlSpaceId === id))
          continue
        if (next.filter((item) => item.controlSpaceId).length >= 10) break
        const title = spaceName(space)
        const name = next.some((item) => item.name?.toLowerCase() === title.toLowerCase())
          ? `${title.slice(0, 109)} (${id.slice(0, 8)})`
          : title.slice(0, 120)
        next.push({
          id: crypto.randomUUID(),
          controlSpaceId: id,
          name,
          description: space.technical_summary?.description?.slice(0, 2000) ?? '',
          isMissing: false,
        })
      }
      return next
    })
  }

  return (
    <form
      noValidate
      className="flex max-h-[80dvh] min-h-0 flex-col text-text-primary"
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (validation.isValid && unavailableBindingIds.size === 0) onConfirm(draft)
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $['agentDetail.configure.knowledgeFs.title'])}</DialogTitle>
        <DialogDescription>
          {t(($) => $['agentDetail.configure.knowledgeFs.select'])}
        </DialogDescription>
        <DialogHeaderCloseButton aria-label={tc(($) => $['operation.close'])} />
      </DialogHeader>
      <Combobox<string, true, SpaceOption>
        inline
        open
        multiple
        items={optionItems}
        value={selectedIds}
        onValueChange={select}
      >
        <div className="shrink-0 px-6 pb-3">
          <ComboboxInputGroup>
            <span
              aria-hidden
              className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            />
            <ComboboxInput
              ref={filterRef}
              enterKeyHint="search"
              aria-label={t(($) => $['agentDetail.configure.knowledgeFs.filter'])}
              placeholder={t(($) => $['agentDetail.configure.knowledgeFs.filter'])}
            />
          </ComboboxInputGroup>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-6 pb-4 system-sm-regular">
          {draft.some((item) => item.isMissing && !unavailableBindingIds.has(item.id)) && (
            <p role="alert" className="system-xs-regular text-text-warning">
              {t(($) => $['agentDetail.configure.knowledgeFs.rebind'])}
            </p>
          )}
          <ComboboxStatus className="sr-only">
            {spacesQuery.isPending && t(($) => $['agentDetail.configure.knowledgeFs.loading'])}
          </ComboboxStatus>
          {spacesQuery.isPending && (
            <div aria-hidden className="space-y-1">
              {Array.from({ length: 5 }, (_, index) => (
                <div
                  key={index}
                  className="flex h-14 items-center gap-3 px-2 motion-safe:animate-pulse"
                >
                  <span className="size-8 rounded-lg bg-background-section" />
                  <span className="h-4 w-1/2 rounded bg-background-section" />
                </div>
              ))}
            </div>
          )}
          {spacesQuery.isError && (
            <div role="alert" className="space-y-2 py-3 system-sm-regular text-text-destructive">
              <p>{t(($) => $['agentDetail.configure.knowledgeFs.loadError'])}</p>
              <Button onClick={() => void spacesQuery.refetch()} loading={spacesQuery.isFetching}>
                {t(($) => $['agentDetail.configure.knowledgeFs.retry'])}
              </Button>
            </div>
          )}
          {!spacesQuery.isPending && !spacesQuery.isError && (
            <>
              <ComboboxList<SpaceOption>
                aria-label={t(($) => $['agentDetail.configure.knowledgeFs.select'])}
                className="max-h-none overflow-visible p-0"
              >
                {(option) => (
                  <KnowledgeSpaceOptionItem
                    key={option.id}
                    option={option}
                    disabled={!selectedIds.includes(option.id) && spaceCount >= 10}
                  />
                )}
              </ComboboxList>
              <ComboboxEmpty className="px-0 py-8 text-center">
                {t(($) => $['agentDetail.configure.knowledgeFs.empty'])}
              </ComboboxEmpty>
            </>
          )}
          {spacesQuery.hasNextPage && (
            <Button
              onClick={() => void spacesQuery.fetchNextPage()}
              loading={spacesQuery.isFetchingNextPage}
            >
              {t(($) => $['agentDetail.configure.knowledgeFs.loadMore'])}
            </Button>
          )}
          {draft.length > 0 && (
            <Collapsible className="border-t-[0.5px] border-divider-subtle pt-3">
              <CollapsibleTrigger className="group -mx-2 flex h-8 w-[calc(100%+1rem)] touch-manipulation items-center gap-1 rounded-lg px-2 text-start system-sm-medium text-text-secondary select-none hover:bg-state-base-hover">
                <span className="flex-1">
                  {t(($) => $['agentDetail.configure.advancedSettings.label'])}
                </span>
                <span
                  aria-hidden
                  className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="space-y-2 pt-2">
                  {draft.map((item) => {
                    const title = item.controlSpaceId
                      ? spaceName(spacesById.get(item.controlSpaceId))
                      : item.name || fallbackName
                    const unavailable = unavailableBindingIds.has(item.id)
                    return (
                      <fieldset
                        key={item.id}
                        className="min-w-0 space-y-3 rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-3 shadow-xs"
                      >
                        <legend className="sr-only">{title}</legend>
                        <div aria-hidden className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              'flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg',
                              unavailable ? 'text-text-warning' : 'text-text-tertiary',
                            )}
                          >
                            <span
                              className={cn(
                                'size-3.5',
                                unavailable ? 'i-ri-error-warning-line' : 'i-ri-book-open-line',
                              )}
                            />
                          </span>
                          <span className="min-w-0 truncate system-sm-semibold text-text-primary">
                            {title}
                          </span>
                        </div>
                        <Field invalid={submitted && !!validation.byId[item.id]?.name}>
                          <FieldLabel className="system-xs-medium text-text-tertiary">
                            {t(($) => $['agentDetail.configure.knowledgeFs.alias'])}
                          </FieldLabel>
                          <Input
                            required
                            maxLength={120}
                            value={item.name ?? ''}
                            onChange={(event) => update(item.id, { name: event.target.value })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="system-xs-medium text-text-tertiary">
                            {t(($) => $['agentDetail.configure.knowledgeFs.bindingDescription'])}
                          </FieldLabel>
                          <Textarea
                            maxLength={2000}
                            value={item.description ?? ''}
                            onValueChange={(value) => update(item.id, { description: value })}
                          />
                        </Field>
                      </fieldset>
                    )
                  })}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          )}
          {submitted && (validation.firstIssue || unavailableBindingIds.size > 0) && (
            <p role="alert" className="system-xs-regular text-text-destructive">
              {validation.firstIssue
                ? validationMessage(validation.firstIssue.code)
                : t(($) => $['agentDetail.configure.knowledgeFs.unavailable'])}
            </p>
          )}
        </div>
      </Combobox>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-divider-subtle px-6 py-4">
        <span role="status" className="me-auto system-xs-medium text-text-tertiary tabular-nums">
          {spaceCount} / 10
        </span>
        <Button onClick={onClose}>{tc(($) => $['operation.cancel'])}</Button>
        <Button type="submit" variant="primary">
          {tc(($) => $['operation.confirm'])}
        </Button>
      </div>
    </form>
  )
}

/** The composer changes only on explicit confirmation. */
export function AgentKnowledgeRetrievalDialog({
  open,
  initialBindings,
  onConfirm,
  onOpenChange,
}: Props) {
  const filterRef = useRef<HTMLInputElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={filterRef} className="w-xl overflow-hidden">
        <AgentKnowledgeRetrievalForm
          initialBindings={initialBindings}
          filterRef={filterRef}
          onConfirm={onConfirm}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
