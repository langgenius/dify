'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RefObject } from 'react'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
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
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useKnowledgeValidationMessage,
  validateKnowledgeRetrievals,
} from '@/features/agent-v2/agent-composer/knowledge-validation'
import { getVisibleKnowledgeRetrievals } from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { consoleQuery } from '@/service/console'
import { useClassicKnowledgeCatalog } from './classic-catalog'
import { ClassicKnowledgeSettings } from './classic-settings'

type Props = {
  open: boolean
  knowledgeFsEnabled: boolean
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

// Option values carry their source, so classic bindings, unbound classic datasets and
// Agent Knowledge Bases can share one selection without id collisions.
const bindingValue = (id: string) => `binding:${id}`
const datasetValue = (id: string) => `dataset:${id}`
const spaceValue = (id: string) => `space:${id}`
const parseValue = (value: string) => {
  const separator = value.indexOf(':')
  return { kind: value.slice(0, separator), id: value.slice(separator + 1) }
}

// Metadata condition rows are keyed by id while editing; older saved conditions may lack one.
const withConditionIds = (item: AgentKnowledgeRetrievalItem): AgentKnowledgeRetrievalItem =>
  item.metadataFilteringConditions
    ? {
        ...item,
        metadataFilteringConditions: {
          ...item.metadataFilteringConditions,
          conditions: item.metadataFilteringConditions.conditions.map((condition) => ({
            ...condition,
            id: condition.id || crypto.randomUUID(),
          })),
        },
      }
    : item

type KnowledgeOption = {
  value: string
  name: string
  description?: string | null
  unavailable: boolean
  disabled: boolean
}

type KnowledgeOptionGroup = {
  value: 'classic' | 'spaces'
  label?: string
  items: KnowledgeOption[]
}

function KnowledgeOptionItem({ option }: { option: KnowledgeOption }) {
  const { t } = useTranslation(['agentV2'])
  const description = option.unavailable
    ? t(($) => $['agentDetail.configure.knowledgeFs.unavailable'])
    : option.description

  return (
    <ComboboxItem<string>
      value={option.value}
      disabled={option.disabled}
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

function CatalogState({
  query,
  loadingLabel,
  errorLabel,
  retryLabel,
  loadMoreLabel,
}: {
  query: {
    isPending: boolean
    isError: boolean
    isFetching: boolean
    hasNextPage: boolean
    isFetchingNextPage: boolean
    refetch: () => Promise<unknown>
    fetchNextPage: () => Promise<unknown>
  }
  loadingLabel: string
  errorLabel: string
  retryLabel: string
  loadMoreLabel: string
}) {
  return (
    <>
      {query.isPending && (
        <div className="space-y-1">
          <span className="sr-only">{loadingLabel}</span>
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              aria-hidden
              className="flex h-12 items-center gap-3 px-2 motion-safe:animate-pulse"
            >
              <span className="size-7 rounded-lg bg-background-section" />
              <span className="h-4 w-1/2 rounded bg-background-section" />
            </div>
          ))}
        </div>
      )}
      {query.isError && (
        <div role="alert" className="space-y-2 py-3 system-sm-regular text-text-destructive">
          <p>{errorLabel}</p>
          <Button onClick={() => void query.refetch()} loading={query.isFetching}>
            {retryLabel}
          </Button>
        </div>
      )}
      {query.hasNextPage && (
        <Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
          {loadMoreLabel}
        </Button>
      )}
    </>
  )
}

/** Draft state lives as long as the dialog content: each opening starts from the saved bindings. */
function AgentKnowledgeRetrievalForm({
  initialBindings: bindings,
  knowledgeFsEnabled,
  onConfirm,
  onClose,
  filterRef,
}: FormProps) {
  const { t } = useTranslation(['agentV2', 'datasetSettings', 'appDebug', 'knowledgeSpace'])
  const { t: tc } = useTranslation(['common'])
  const [initialBindings] = useState(() => bindings.map(withConditionIds))
  const [draft, setDraft] = useState(initialBindings)
  const [submitted, setSubmitted] = useState(false)
  const validationMessage = useKnowledgeValidationMessage()
  const classic = useClassicKnowledgeCatalog({ draft, initialBindings })
  const spacesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      enabled: knowledgeFsEnabled,
      input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  )
  const spaces = useMemo(
    () => (knowledgeFsEnabled ? (spacesQuery.data?.pages.flatMap((page) => page.data) ?? []) : []),
    [knowledgeFsEnabled, spacesQuery.data],
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
            if (!knowledgeFsEnabled || !item.controlSpaceId) return false
            const space = spacesById.get(item.controlSpaceId)
            return space ? !canBindSpace(space) : catalogComplete
          })
          .map((item) => item.id),
      ),
    [catalogComplete, draft, knowledgeFsEnabled, spacesById],
  )
  const fallbackName = t(($) => $['agentDetail.configure.knowledgeFs.title'])
  const spaceName = (space?: KnowledgeFsSpaceListItemResponse) =>
    space?.technical_summary?.name || fallbackName
  const spaceCount = draft.filter((item) => item.controlSpaceId).length
  const selectedIds = [
    ...draft.flatMap((item) => (item.controlSpaceId ? [] : [bindingValue(item.id)])),
    ...new Set(
      draft.flatMap((item) =>
        item.controlSpaceId && (!item.isMissing || unavailableBindingIds.has(item.id))
          ? [spaceValue(item.controlSpaceId)]
          : [],
      ),
    ),
  ]
  const classicOptions: KnowledgeOption[] = classic.entries.map((entry) =>
    entry.kind === 'binding'
      ? {
          value: bindingValue(entry.item.id),
          name: entry.item.name || entry.item.id,
          description: entry.item.description,
          unavailable: false,
          disabled: false,
        }
      : {
          value: datasetValue(entry.dataset.id),
          name: entry.dataset.name,
          description: entry.dataset.description,
          unavailable: false,
          disabled: !entry.dataset.embedding_available,
        },
  )
  // Unavailable bindings stay listed as selected options, so deselecting one is how it is removed.
  const spaceOptions = new Map<string, KnowledgeOption>()
  for (const space of spaces) {
    if (!canBindSpace(space)) continue
    const value = spaceValue(space.control_space_id)
    spaceOptions.set(value, {
      value,
      name: spaceName(space),
      description: space.technical_summary?.description,
      unavailable: false,
      disabled: !selectedIds.includes(value) && spaceCount >= 10,
    })
  }
  for (const item of draft) {
    if (!item.controlSpaceId || !unavailableBindingIds.has(item.id)) continue
    const value = spaceValue(item.controlSpaceId)
    if (spaceOptions.has(value)) continue
    spaceOptions.set(value, {
      value,
      name: item.name || spaceName(spacesById.get(item.controlSpaceId)),
      unavailable: true,
      disabled: false,
    })
  }
  const groups: KnowledgeOptionGroup[] = [
    {
      value: 'classic',
      label: knowledgeFsEnabled ? t(($) => $['view.classic'], { ns: 'knowledgeSpace' }) : undefined,
      items: classicOptions,
    },
    ...(knowledgeFsEnabled
      ? [
          {
            value: 'spaces' as const,
            label: t(($) => $['agentDetail.configure.knowledgeFs.select']),
            items: [...spaceOptions.values()],
          },
        ]
      : []),
  ]
  const optionItems = createComboboxItems(groups, {
    getValue: (option) => option.value,
    getLabel: (option) => option.name,
  })
  const visibleBindings = getVisibleKnowledgeRetrievals(draft, knowledgeFsEnabled)
  const validation = validateKnowledgeRetrievals(visibleBindings, draft)
  const update = (id: string, patch: Partial<AgentKnowledgeRetrievalItem>) =>
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const select = (nextIds: string[]) => {
    const removed = selectedIds.filter((id) => !nextIds.includes(id)).map(parseValue)
    const added = nextIds.filter((id) => !selectedIds.includes(id)).map(parseValue)
    const removedBindings = new Set(
      removed.flatMap(({ kind, id }) => (kind === 'binding' ? [id] : [])),
    )
    const removedSpaces = new Set(removed.flatMap(({ kind, id }) => (kind === 'space' ? [id] : [])))
    const addedSpaces = added.flatMap(({ kind, id }) => (kind === 'space' ? [id] : []))
    setDraft((current) => {
      const next = current
        .filter((item) =>
          item.controlSpaceId
            ? !removedSpaces.has(item.controlSpaceId)
            : !removedBindings.has(item.id),
        )
        .map((item) =>
          item.controlSpaceId && item.isMissing && addedSpaces.includes(item.controlSpaceId)
            ? { ...item, isMissing: false }
            : item,
        )
      for (const { kind, id } of added) {
        if (kind === 'binding') {
          const binding = classic.bindings.find((item) => item.id === id)
          if (binding && !next.some((item) => item.id === id)) next.push(binding)
          continue
        }
        if (kind === 'dataset') {
          const dataset = classic.datasets.find((item) => item.id === id)
          if (dataset) next.push(classic.createBinding(dataset, next))
          continue
        }
        const space = spacesById.get(id)
        if (!space || !canBindSpace(space) || next.some((item) => item.controlSpaceId === id))
          continue
        if (next.filter((item) => item.controlSpaceId).length >= 10) continue
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
      className="flex min-h-0 flex-1 flex-col text-text-primary"
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (validation.isValid && unavailableBindingIds.size === 0) onConfirm(draft)
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.title'])}
        </DialogTitle>
        <DialogDescription>
          {t(($) => $['agentDetail.configure.knowledgeRetrieval.empty.description'])}
        </DialogDescription>
        <DialogHeaderCloseButton aria-label={tc(($) => $['operation.close'])} />
      </DialogHeader>
      <Combobox<string, true, KnowledgeOption>
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
              aria-label={tc(($) => $['operation.search'])}
              placeholder={tc(($) => $['operation.search'])}
            />
          </ComboboxInputGroup>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 pb-4 system-sm-regular">
          {knowledgeFsEnabled &&
            draft.some((item) => item.isMissing && !unavailableBindingIds.has(item.id)) && (
              <p role="alert" className="system-xs-regular text-text-warning">
                {t(($) => $['agentDetail.configure.knowledgeFs.rebind'])}
              </p>
            )}
          <ComboboxStatus className="sr-only">
            {(classic.query.isPending || (knowledgeFsEnabled && spacesQuery.isPending)) &&
              tc(($) => $.loading)}
          </ComboboxStatus>
          <ComboboxList<KnowledgeOptionGroup>
            aria-label={t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.title'])}
            className="max-h-none overflow-visible p-0"
          >
            {(group) => (
              <ComboboxGroup key={group.value} items={group.items}>
                {!!group.label && <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>}
                <ComboboxCollection<KnowledgeOption>>
                  {(option) => <KnowledgeOptionItem key={option.value} option={option} />}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
          {!classic.query.isPending && (!knowledgeFsEnabled || !spacesQuery.isPending) && (
            <ComboboxEmpty className="px-0 py-8 text-center">
              {knowledgeFsEnabled
                ? t(($) => $['agentDetail.configure.knowledgeFs.empty'])
                : t(($) => $['feature.dataSet.noDataSet'], { ns: 'appDebug' })}
            </ComboboxEmpty>
          )}
          <CatalogState
            query={classic.query}
            loadingLabel={tc(($) => $.loading)}
            errorLabel={tc(($) => $.error)}
            retryLabel={tc(($) => $['operation.retry'])}
            loadMoreLabel={t(($) => $.loadMore, { ns: 'knowledgeSpace' })}
          />
          {knowledgeFsEnabled && (
            <CatalogState
              query={spacesQuery}
              loadingLabel={t(($) => $['agentDetail.configure.knowledgeFs.loading'])}
              errorLabel={t(($) => $['agentDetail.configure.knowledgeFs.loadError'])}
              retryLabel={t(($) => $['agentDetail.configure.knowledgeFs.retry'])}
              loadMoreLabel={t(($) => $['agentDetail.configure.knowledgeFs.loadMore'])}
            />
          )}
          {visibleBindings.length > 0 && (
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
                  {visibleBindings.map((item) => {
                    const title = item.controlSpaceId
                      ? spaceName(spacesById.get(item.controlSpaceId))
                      : item.name || item.id
                    const unavailable = unavailableBindingIds.has(item.id)
                    const errors = validation.byId[item.id]
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
                        <Field invalid={submitted && !!errors?.name}>
                          <FieldLabel className="system-xs-medium text-text-tertiary">
                            {item.controlSpaceId
                              ? t(($) => $['agentDetail.configure.knowledgeFs.alias'])
                              : t(
                                  ($) =>
                                    $['agentDetail.configure.knowledgeRetrieval.dialog.nameLabel'],
                                )}
                          </FieldLabel>
                          <Input
                            required
                            maxLength={item.controlSpaceId ? 120 : 255}
                            value={item.name ?? ''}
                            onChange={(event) => update(item.id, { name: event.target.value })}
                          />
                          {submitted && errors?.name && (
                            <FieldError match>{validationMessage(errors.name)}</FieldError>
                          )}
                        </Field>
                        <Field>
                          <FieldLabel className="system-xs-medium text-text-tertiary">
                            {item.controlSpaceId
                              ? t(($) => $['agentDetail.configure.knowledgeFs.bindingDescription'])
                              : t(($) => $['form.desc'], { ns: 'datasetSettings' })}
                          </FieldLabel>
                          <Textarea
                            maxLength={item.controlSpaceId ? 2000 : undefined}
                            value={item.description ?? ''}
                            onValueChange={(value) => update(item.id, { description: value })}
                          />
                        </Field>
                        {!item.controlSpaceId && (
                          <ClassicKnowledgeSettings
                            item={item}
                            onChange={(patch) => update(item.id, patch)}
                            errors={submitted ? errors : undefined}
                          />
                        )}
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
          {visibleBindings.length} {t(($) => $['feature.dataSet.selected'], { ns: 'appDebug' })}
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
  knowledgeFsEnabled,
  onConfirm,
  onOpenChange,
}: Props) {
  const filterRef = useRef<HTMLInputElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed height keeps the centered dialog still while knowledge is ticked;
          growing would re-center it and slide the list under the pointer. */}
      <DialogContent initialFocus={filterRef} className="h-[min(40rem,80dvh)] w-xl overflow-hidden">
        <AgentKnowledgeRetrievalForm
          initialBindings={initialBindings}
          knowledgeFsEnabled={knowledgeFsEnabled}
          filterRef={filterRef}
          onConfirm={onConfirm}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
