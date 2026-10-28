'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RefObject } from 'react'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import {
  useKnowledgeValidationMessage,
  validateKnowledgeRetrievals,
} from '@/features/agent-v2/agent-composer/knowledge-validation'
import { consoleQuery } from '@/service/console'
import { KnowledgeBindingOption } from './binding-option'
import { ClassicKnowledgePicker } from './classic-picker'
import { ClassicKnowledgeSettings } from './classic-settings'

type Props = {
  open: boolean
  knowledgeFsEnabled: boolean
  initialBindings: AgentKnowledgeRetrievalItem[]
  onConfirm: (bindings: AgentKnowledgeRetrievalItem[]) => void
  onOpenChange: (open: boolean) => void
}

type FormProps = Omit<Props, 'open' | 'onOpenChange'> & {
  searchRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}

const canBindSpace = (space: KnowledgeFsSpaceListItemResponse) =>
  space.state === 'active' &&
  space.technical_status === 'available' &&
  space.permission_keys.includes('knowledge_space_read') &&
  space.permission_keys.includes('knowledge_space_query')

/** Draft state lives as long as the dialog content: each opening starts from the saved bindings. */
function AgentKnowledgeRetrievalForm({
  initialBindings,
  knowledgeFsEnabled,
  onConfirm,
  onClose,
  searchRef,
}: FormProps) {
  const { t } = useTranslation(['agentV2', 'datasetSettings', 'appDebug'])
  const { t: tc } = useTranslation(['common'])
  const [draft, setDraft] = useState(initialBindings)
  const [filter, setFilter] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const validationMessage = useKnowledgeValidationMessage()
  const spacesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      enabled: knowledgeFsEnabled,
      input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  )
  const spaces = knowledgeFsEnabled
    ? (spacesQuery.data?.pages.flatMap((page) => page.data) ?? [])
    : []
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
        if (!knowledgeFsEnabled || !item.controlSpaceId || item.isMissing) return false
        const space = spacesById.get(item.controlSpaceId)
        return space ? !canBindSpace(space) : spacesQuery.isSuccess && !spacesQuery.hasNextPage
      })
      .map((item) => item.id),
  )
  const visibleBindings = draft.filter((item) => knowledgeFsEnabled || !item.controlSpaceId)
  const validation = validateKnowledgeRetrievals(visibleBindings)
  const spaceCount = draft.filter((item) => item.controlSpaceId).length
  const update = (id: string, patch: Partial<AgentKnowledgeRetrievalItem>) =>
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const toggle = (space: KnowledgeFsSpaceListItemResponse, checked: boolean) => {
    setDraft((current) => {
      const existing = current.find((item) => item.controlSpaceId === space.control_space_id)
      if (!checked) return current.filter((item) => item !== existing)
      if (!canBindSpace(space)) return current
      if (existing)
        return current.map((item) => (item === existing ? { ...item, isMissing: false } : item))
      if (current.filter((item) => item.controlSpaceId).length >= 10) return current
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
    <form
      noValidate
      className="flex max-h-[80dvh] min-h-0 flex-col text-text-primary"
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (validation.isValid && unavailableBindingIds.size === 0) onConfirm(draft)
        else setAdvancedOpen(true)
      }}
    >
      <DialogHeader>
        <div className="flex items-center gap-2">
          <DialogTitle>
            {t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.title'])}
          </DialogTitle>
          <Infotip>
            <InfotipTrigger
              aria-label={t(($) => $['agentDetail.configure.knowledgeRetrieval.empty.description'])}
            />
            <InfotipContent>
              {t(($) => $['agentDetail.configure.knowledgeRetrieval.empty.description'])}
            </InfotipContent>
          </Infotip>
        </div>
        <DialogDescription>
          {t(($) => $['agentDetail.configure.knowledgeRetrieval.empty.description'])}
        </DialogDescription>
        <DialogHeaderCloseButton aria-label={tc(($) => $['operation.close'])} />
      </DialogHeader>
      <div className="shrink-0 px-6 pb-4">
        <SearchInput
          ref={searchRef}
          value={filter}
          onValueChange={setFilter}
          aria-label={tc(($) => $['operation.search'])}
        />
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4 system-sm-regular">
        {knowledgeFsEnabled && draft.some((item) => item.isMissing) && (
          <p role="alert" className="px-2 system-xs-regular text-text-warning">
            {t(($) => $['agentDetail.configure.knowledgeFs.rebind'])}
          </p>
        )}
        {unavailableBindingIds.size > 0 && (
          <p role="alert" className="px-2 system-xs-regular text-text-warning">
            {t(($) => $['agentDetail.configure.knowledgeFs.unavailable'])}
          </p>
        )}
        <ClassicKnowledgePicker
          draft={draft}
          initialBindings={initialBindings}
          filter={filter}
          showSourceLabel={knowledgeFsEnabled}
          onSelect={(item) => setDraft((current) => [...current, item])}
          onRemove={(id) => setDraft((current) => current.filter((item) => item.id !== id))}
        />
        {knowledgeFsEnabled && (
          <div>
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
              <legend className="px-2 system-xs-medium text-text-secondary">
                {t(($) => $['agentDetail.configure.knowledgeFs.select'])}
              </legend>
              {visibleSpaces.map((space) => {
                const binding = draft.find((item) => item.controlSpaceId === space.control_space_id)
                const checked = !!binding && !binding.isMissing
                return (
                  <KnowledgeBindingOption
                    key={space.control_space_id}
                    name={
                      space.technical_summary?.name ||
                      t(($) => $['agentDetail.configure.knowledgeFs.title'])
                    }
                    description={space.technical_summary?.description}
                    checked={checked}
                    disabled={!checked && !binding && spaceCount >= 10}
                    onCheckedChange={(next) => toggle(space, next)}
                  />
                )
              })}
            </fieldset>
            {spacesQuery.hasNextPage && (
              <Button
                className="ms-2"
                onClick={() => void spacesQuery.fetchNextPage()}
                loading={spacesQuery.isFetchingNextPage}
              >
                {t(($) => $['agentDetail.configure.knowledgeFs.loadMore'])}
              </Button>
            )}
          </div>
        )}
        {visibleBindings.length > 0 && (
          <Collapsible
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
            className="border-t border-divider-subtle pt-2"
          >
            <CollapsibleTrigger className="group flex min-h-8 w-full touch-manipulation items-center justify-between gap-2 rounded-lg px-2.5 text-start system-sm-medium text-text-secondary select-none hover:bg-components-panel-on-panel-item-bg-hover hover:text-text-primary data-panel-open:text-text-primary">
              <span>
                {t(($) => $['agentDetail.configure.advancedSettings.label'])}{' '}
                <span className="system-xs-regular text-text-tertiary">
                  {tc(($) => $['label.optional'])}
                </span>
              </span>
              <span
                aria-hidden
                className="i-ri-arrow-right-s-line size-4 shrink-0 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="space-y-3 px-2 pt-3">
                {visibleBindings.map((item) => (
                  <fieldset
                    key={item.id}
                    className="min-w-0 space-y-3 rounded-xl bg-background-section p-3"
                  >
                    <legend className="sr-only">{item.name || item.id}</legend>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate system-sm-medium">
                        {item.name || item.id}
                      </span>
                      <IconButton
                        aria-label={t(($) => $['agentDetail.configure.knowledgeRetrieval.remove'], {
                          name: item.name || item.id,
                        })}
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
                        {item.controlSpaceId
                          ? t(($) => $['agentDetail.configure.knowledgeFs.alias'])
                          : t(
                              ($) => $['agentDetail.configure.knowledgeRetrieval.dialog.nameLabel'],
                            )}
                      </FieldLabel>
                      <Input
                        required
                        maxLength={item.controlSpaceId ? 120 : 255}
                        value={item.name ?? ''}
                        onChange={(event) => update(item.id, { name: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>
                        {item.controlSpaceId
                          ? t(($) => $['agentDetail.configure.knowledgeFs.bindingDescription'])
                          : t(($) => $['form.desc'], { ns: 'datasetSettings' })}
                      </FieldLabel>
                      <Textarea
                        rows={3}
                        maxLength={item.controlSpaceId ? 2000 : undefined}
                        value={item.description ?? ''}
                        onValueChange={(value) => update(item.id, { description: value })}
                      />
                    </Field>
                    {!item.controlSpaceId && (
                      <ClassicKnowledgeSettings
                        item={item}
                        onChange={(patch) => update(item.id, patch)}
                        errors={submitted ? validation.byId[item.id] : undefined}
                      />
                    )}
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
  const searchRef = useRef<HTMLInputElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={searchRef} className="w-144 overflow-hidden">
        <AgentKnowledgeRetrievalForm
          initialBindings={initialBindings}
          knowledgeFsEnabled={knowledgeFsEnabled}
          searchRef={searchRef}
          onConfirm={onConfirm}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
