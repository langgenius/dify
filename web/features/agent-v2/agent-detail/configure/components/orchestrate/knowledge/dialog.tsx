'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { SearchInput } from '@/app/components/base/search-input'
import {
  useKnowledgeValidationMessage,
  validateKnowledgeRetrievals,
} from '@/features/agent-v2/agent-composer/knowledge-validation'
import { consoleQuery } from '@/service/console'

type Props = {
  initialBindings: AgentKnowledgeRetrievalItem[]
  onConfirm: (bindings: AgentKnowledgeRetrievalItem[]) => void
  onClose: () => void
}

const canBindSpace = (space: KnowledgeFsSpaceListItemResponse) =>
  space.state === 'active' &&
  space.technical_status === 'available' &&
  space.permission_keys.includes('knowledge_space_read') &&
  space.permission_keys.includes('knowledge_space_query') &&
  space.permission_keys.includes('knowledge_space_access_config')

function KnowledgeSpaceOption({
  space,
  checked,
  disabled,
  onCheckedChange,
}: {
  space: KnowledgeFsSpaceListItemResponse
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const { t } = useTranslation('agentV2')
  const id = useId()
  const name =
    space.technical_summary?.name || t(($) => $['agentDetail.configure.knowledgeFs.title'])
  const description = space.technical_summary?.description

  return (
    <div
      className={cn(
        'group/space flex h-14 min-w-0 items-center gap-2 rounded-lg px-2 transition-colors motion-reduce:transition-none',
        checked
          ? 'bg-state-accent-active'
          : 'focus-within:bg-state-base-hover hover:bg-state-base-hover',
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-3',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-panel-on-panel-item-bg text-text-secondary shadow-xs group-focus-within/space:text-text-accent group-hover/space:text-text-accent"
        >
          <span className="i-ri-book-open-line size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            id={`${id}-name`}
            className={cn(
              'block truncate system-sm-medium',
              disabled
                ? 'text-text-tertiary'
                : 'text-text-secondary group-focus-within/space:text-text-primary group-hover/space:text-text-primary',
            )}
          >
            {name}
          </span>
          {!!description && (
            <span className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-150 group-focus-within/space:grid-rows-[1fr] group-focus-within/space:opacity-100 group-hover/space:grid-rows-[1fr] group-hover/space:opacity-100 motion-reduce:transition-none">
              <span
                id={`${id}-description`}
                className="min-h-0 truncate overflow-hidden system-xs-regular text-text-tertiary"
              >
                {description}
              </span>
            </span>
          )}
        </span>
        <Checkbox
          id={id}
          aria-labelledby={`${id}-name`}
          aria-describedby={description ? `${id}-description` : undefined}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </label>
    </div>
  )
}

/** Mounted once per interaction: the composer changes only on explicit confirmation. */
export function AgentKnowledgeRetrievalDialog({ initialBindings, onConfirm, onClose }: Props) {
  const { t } = useTranslation('agentV2')
  const { t: tc } = useTranslation('common')
  const [draft, setDraft] = useState(initialBindings)
  const [filter, setFilter] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const validationMessage = useKnowledgeValidationMessage()
  const spacesQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  })
  const spaces = spacesQuery.data?.pages.flatMap((page) => page.data) ?? []
  const spacesById = new Map(spaces.map((space) => [space.control_space_id, space]))
  const visibleSpaces = spaces.filter(
    (space) =>
      canBindSpace(space) &&
      (space.technical_summary?.name ?? '')
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase()),
  )
  // A later catalog page may contain a saved binding; absence is conclusive only
  // after a successful, complete listing. Never discard a binding on query refresh.
  const unavailableBindingIds = new Set(
    draft
      .filter((item) => {
        if (!item.controlSpaceId || item.isMissing) return false
        const space = spacesById.get(item.controlSpaceId)
        return space ? !canBindSpace(space) : spacesQuery.isSuccess && !spacesQuery.hasNextPage
      })
      .map((item) => item.id),
  )
  const validation = validateKnowledgeRetrievals(draft)
  const legacy = draft.some((item) => !item.controlSpaceId)
  const update = (id: string, patch: Partial<AgentKnowledgeRetrievalItem>) =>
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const toggle = (space: KnowledgeFsSpaceListItemResponse, checked: boolean) => {
    setDraft((current) => {
      const existing = current.find((item) => item.controlSpaceId === space.control_space_id)
      if (!checked) return current.filter((item) => item !== existing)
      if (!canBindSpace(space)) return current
      if (existing)
        return current.map((item) => (item === existing ? { ...item, isMissing: false } : item))
      if (current.length >= 10) return current
      const title =
        space.technical_summary?.name || t(($) => $['agentDetail.configure.knowledgeFs.title'])
      const name = current.some((item) => item.name?.toLowerCase() === title.toLowerCase())
        ? `${title.slice(0, 109)} (${space.control_space_id.slice(0, 8)})`
        : title.slice(0, 120)
      return [
        ...current,
        {
          id: crypto.randomUUID(),
          controlSpaceId: space.control_space_id,
          name,
          description: space.technical_summary?.description?.slice(0, 2000) ?? '',
          isMissing: false,
        },
      ]
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        initialFocus={searchRef}
        className="w-144 overflow-hidden p-0 text-text-primary"
      >
        <form
          noValidate
          className="flex max-h-[80dvh] flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
            if (validation.isValid && unavailableBindingIds.size === 0) onConfirm(draft)
            else setAdvancedOpen(true)
          }}
        >
          <div className="shrink-0 px-6 pt-6 pb-4">
            <div className="flex items-center gap-2">
              <DialogTitle className="title-xl-semi-bold text-text-primary">
                {t(($) => $['agentDetail.configure.knowledgeFs.title'])}
              </DialogTitle>
              <Infotip aria-label={t(($) => $['agentDetail.configure.knowledgeFs.description'])}>
                {t(($) => $['agentDetail.configure.knowledgeFs.description'])}
              </Infotip>
              <IconButton
                className="ml-auto shrink-0"
                aria-label={tc(($) => $['operation.close'])}
                onClick={onClose}
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            </div>
            <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
              {t(($) => $['agentDetail.configure.knowledgeFs.select'])}
            </DialogDescription>
            <div className="mt-4">
              <SearchInput
                ref={searchRef}
                value={filter}
                onValueChange={setFilter}
                aria-label={t(($) => $['agentDetail.configure.knowledgeFs.filter'])}
              />
            </div>
          </div>
          <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4 system-sm-regular">
            {legacy && (
              <div
                role="alert"
                className="space-y-2 rounded-lg bg-background-section p-3 system-xs-regular text-text-warning"
              >
                <p>{t(($) => $['agentDetail.configure.knowledgeFs.legacy'])}</p>
                <Button
                  onClick={() =>
                    setDraft((current) => current.filter((item) => item.controlSpaceId))
                  }
                >
                  {t(($) => $['agentDetail.configure.knowledgeFs.removeLegacy'])}
                </Button>
              </div>
            )}
            {draft.some((item) => item.isMissing) && (
              <p role="alert" className="px-2 system-xs-regular text-text-warning">
                {t(($) => $['agentDetail.configure.knowledgeFs.rebind'])}
              </p>
            )}
            {unavailableBindingIds.size > 0 && (
              <p role="alert" className="px-2 system-xs-regular text-text-warning">
                {t(($) => $['agentDetail.configure.knowledgeFs.unavailable'])}
              </p>
            )}
            {spacesQuery.isPending && (
              <div role="status" className="space-y-1">
                <span className="sr-only">
                  {t(($) => $['agentDetail.configure.knowledgeFs.loading'])}
                </span>
                {Array.from({ length: 5 }, (_, index) => (
                  <div
                    key={index}
                    aria-hidden
                    className="flex h-14 items-center gap-3 px-2 motion-safe:animate-pulse"
                  >
                    <span className="size-8 rounded-lg bg-background-section" />
                    <span className="h-4 w-1/2 rounded bg-background-section" />
                  </div>
                ))}
              </div>
            )}
            {spacesQuery.isError && (
              <div role="alert" className="space-y-2 p-3 system-sm-regular text-text-destructive">
                <p>{t(($) => $['agentDetail.configure.knowledgeFs.loadError'])}</p>
                <Button onClick={() => void spacesQuery.refetch()} loading={spacesQuery.isFetching}>
                  {t(($) => $['agentDetail.configure.knowledgeFs.retry'])}
                </Button>
              </div>
            )}
            {!spacesQuery.isPending && !spacesQuery.isError && visibleSpaces.length === 0 && (
              <p className="px-2 py-8 text-center system-sm-regular text-text-tertiary">
                {t(($) => $['agentDetail.configure.knowledgeFs.empty'])}
              </p>
            )}
            <fieldset className="min-w-0 space-y-1">
              <legend className="sr-only">
                {t(($) => $['agentDetail.configure.knowledgeFs.select'])}
              </legend>
              {visibleSpaces.map((space) => {
                const binding = draft.find((item) => item.controlSpaceId === space.control_space_id)
                const checked = !!binding && !binding.isMissing
                return (
                  <KnowledgeSpaceOption
                    key={space.control_space_id}
                    space={space}
                    checked={checked}
                    disabled={!checked && !binding && draft.length >= 10}
                    onCheckedChange={(next) => toggle(space, next)}
                  />
                )
              })}
            </fieldset>
            {spacesQuery.hasNextPage && (
              <Button
                className="ml-2"
                onClick={() => void spacesQuery.fetchNextPage()}
                loading={spacesQuery.isFetchingNextPage}
              >
                {t(($) => $['agentDetail.configure.knowledgeFs.loadMore'])}
              </Button>
            )}
            {draft.length > 0 && (
              <Collapsible
                open={advancedOpen}
                onOpenChange={setAdvancedOpen}
                className="border-t border-divider-subtle pt-2"
              >
                <CollapsibleTrigger>
                  <span>
                    {t(($) => $['agentDetail.configure.advancedSettings.label'])}{' '}
                    <span className="system-xs-regular text-text-tertiary">
                      {tc(($) => $['label.optional'])}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="i-ri-arrow-down-s-line size-4 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
                  />
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="space-y-3 px-2 pt-3">
                    {draft.map((item) => (
                      <fieldset
                        key={item.id}
                        className="min-w-0 space-y-3 rounded-xl bg-background-section p-3"
                      >
                        <legend className="sr-only">
                          {item.name || t(($) => $['agentDetail.configure.knowledgeFs.title'])}
                        </legend>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate system-sm-medium">
                            {item.name || t(($) => $['agentDetail.configure.knowledgeFs.title'])}
                          </span>
                          <IconButton
                            aria-label={t(
                              ($) => $['agentDetail.configure.knowledgeRetrieval.remove'],
                              {
                                name:
                                  item.name ||
                                  t(($) => $['agentDetail.configure.knowledgeFs.title']),
                              },
                            )}
                            tone="destructive"
                            onClick={() =>
                              setDraft((current) => current.filter((row) => row.id !== item.id))
                            }
                          >
                            <span aria-hidden className="i-ri-delete-bin-line size-4" />
                          </IconButton>
                        </div>
                        {unavailableBindingIds.has(item.id) && (
                          <p className="system-xs-regular text-text-warning">
                            {t(($) => $['agentDetail.configure.knowledgeFs.unavailable'])}
                          </p>
                        )}
                        <Field invalid={submitted && !!validation.byId[item.id]?.name}>
                          <FieldLabel>
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
                          <FieldLabel>
                            {t(($) => $['agentDetail.configure.knowledgeFs.bindingDescription'])}
                          </FieldLabel>
                          <Textarea
                            rows={3}
                            maxLength={2000}
                            value={item.description ?? ''}
                            onValueChange={(value) => update(item.id, { description: value })}
                          />
                        </Field>
                      </fieldset>
                    ))}
                  </div>
                </CollapsiblePanel>
              </Collapsible>
            )}
            {submitted && validation.firstIssue && (
              <p role="alert" className="px-2 system-xs-regular text-text-destructive">
                {validationMessage(validation.firstIssue.code)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-divider-subtle px-6 py-4">
            <span
              role="status"
              className="mr-auto system-xs-medium text-text-tertiary tabular-nums"
            >
              {draft.length} / 10
            </span>
            <Button onClick={onClose}>{tc(($) => $['operation.cancel'])}</Button>
            <Button type="submit" variant="primary">
              {tc(($) => $['operation.confirm'])}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
