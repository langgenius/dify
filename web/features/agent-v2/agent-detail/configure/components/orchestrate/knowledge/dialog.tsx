'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import {
  useKnowledgeValidationMessage,
  validateKnowledgeRetrievals,
} from '@/features/agent-v2/agent-composer/knowledge-validation'
import { consoleQuery } from '@/service/client'

type Props = {
  initialBindings: AgentKnowledgeRetrievalItem[]
  onConfirm: (bindings: AgentKnowledgeRetrievalItem[]) => void
  onClose: () => void
}

const isAvailable = (space: KnowledgeFsSpaceListItemResponse) =>
  space.state === 'active' &&
  space.technical_status === 'available' &&
  space.permission_keys.includes('knowledge_space_read') &&
  space.permission_keys.includes('knowledge_space_query')

/** Mounted once per interaction: the composer changes only on explicit confirmation. */
export function AgentKnowledgeRetrievalDialog({ initialBindings, onConfirm, onClose }: Props) {
  const { t } = useTranslation('agentV2')
  const { t: tc } = useTranslation('common')
  const [draft, setDraft] = useState(initialBindings)
  const [filter, setFilter] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const validationMessage = useKnowledgeValidationMessage()
  const listId = useId()
  const spacesQuery = useInfiniteQuery({
    ...consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  })
  const spaces = spacesQuery.data?.pages.flatMap((page) => page.data) ?? []
  const visibleSpaces = spaces.filter((space) =>
    (space.technical_summary?.name ?? space.control_space_id)
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  )
  const validation = validateKnowledgeRetrievals(draft)
  const legacy = draft.some((item) => !item.controlSpaceId)
  const update = (id: string, patch: Partial<AgentKnowledgeRetrievalItem>) =>
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const toggle = (space: KnowledgeFsSpaceListItemResponse, checked: boolean) => {
    setDraft((current) => {
      const existing = current.find((item) => item.controlSpaceId === space.control_space_id)
      if (!checked) return current.filter((item) => item !== existing)
      if (existing)
        return current.map((item) => (item === existing ? { ...item, isMissing: false } : item))
      if (current.length >= 10 || !isAvailable(space)) return current
      const title = space.technical_summary?.name ?? space.control_space_id
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
      <DialogContent className="w-full max-w-160">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
            if (validation.isValid) onConfirm(draft)
          }}
        >
          <DialogTitle>{t(($) => $['agentDetail.configure.knowledgeFs.title'])}</DialogTitle>
          <DialogDescription className="mt-2 text-text-secondary">
            {t(($) => $['agentDetail.configure.knowledgeFs.description'])}
          </DialogDescription>
          <div className="mt-4 max-h-[65vh] space-y-4 overflow-y-auto p-1">
            {legacy && (
              <div role="alert" className="space-y-2 text-text-warning">
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
            <Field>
              <FieldLabel>{t(($) => $['agentDetail.configure.knowledgeFs.filter'])}</FieldLabel>
              <SearchInput
                value={filter}
                onValueChange={setFilter}
                aria-label={t(($) => $['agentDetail.configure.knowledgeFs.filter'])}
              />
            </Field>
            {spacesQuery.isPending && (
              <p role="status">{t(($) => $['agentDetail.configure.knowledgeFs.loading'])}</p>
            )}
            {spacesQuery.isError && (
              <div role="alert">
                <p>{t(($) => $['agentDetail.configure.knowledgeFs.loadError'])}</p>
                <Button onClick={() => void spacesQuery.refetch()} loading={spacesQuery.isFetching}>
                  {t(($) => $['agentDetail.configure.knowledgeFs.retry'])}
                </Button>
              </div>
            )}
            {!spacesQuery.isPending && !spacesQuery.isError && visibleSpaces.length === 0 && (
              <p>{t(($) => $['agentDetail.configure.knowledgeFs.empty'])}</p>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-2 text-text-secondary">
                {t(($) => $['agentDetail.configure.knowledgeFs.select'])}
              </legend>
              {visibleSpaces.map((space) => {
                const binding = draft.find((item) => item.controlSpaceId === space.control_space_id)
                const available = isAvailable(space)
                const checked = !!binding && !binding.isMissing
                const name = space.technical_summary?.name ?? space.control_space_id
                return (
                  <div
                    key={space.control_space_id}
                    className="rounded-lg border border-divider-subtle p-3"
                  >
                    <label
                      className="flex items-start gap-2"
                      htmlFor={`${listId}-${space.control_space_id}`}
                    >
                      <Checkbox
                        id={`${listId}-${space.control_space_id}`}
                        checked={checked}
                        disabled={!checked && (!available || (!binding && draft.length >= 10))}
                        onCheckedChange={(next) => toggle(space, next)}
                      />
                      <span className="min-w-0 break-words">{name}</span>
                    </label>
                    <p className="mt-1 text-sm break-words text-text-tertiary">
                      {space.technical_summary?.description}
                    </p>
                    {!available && (
                      <p className="text-sm text-text-warning">
                        {t(($) => $['agentDetail.configure.knowledgeFs.unavailable'])}
                      </p>
                    )}
                    {available &&
                      !space.permission_keys.includes('knowledge_space_access_config') && (
                        <p className="text-sm text-text-warning">
                          {t(($) => $['agentDetail.configure.knowledgeFs.publishPermission'])}
                        </p>
                      )}
                  </div>
                )
              })}
            </fieldset>
            {spacesQuery.hasNextPage && (
              <Button
                onClick={() => void spacesQuery.fetchNextPage()}
                loading={spacesQuery.isFetchingNextPage}
              >
                {t(($) => $['agentDetail.configure.knowledgeFs.loadMore'])}
              </Button>
            )}
            {draft.map((item) => (
              <fieldset
                key={item.id}
                className="space-y-2 rounded-lg border border-divider-subtle p-3"
              >
                <legend className="max-w-full break-words">{item.name ?? item.id}</legend>
                <p className="text-xs break-all text-text-tertiary">
                  {item.controlSpaceId ?? item.id}
                </p>
                {item.isMissing && (
                  <p role="alert">{t(($) => $['agentDetail.configure.knowledgeFs.rebind'])}</p>
                )}
                <Field>
                  <FieldLabel>{t(($) => $['agentDetail.configure.knowledgeFs.alias'])}</FieldLabel>
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
                    maxLength={2000}
                    value={item.description ?? ''}
                    onValueChange={(value) => update(item.id, { description: value })}
                  />
                </Field>
                <Button
                  onClick={() => setDraft((current) => current.filter((row) => row.id !== item.id))}
                >
                  {t(($) => $['agentDetail.configure.knowledgeRetrieval.remove'], {
                    name: item.name ?? item.id,
                  })}
                </Button>
              </fieldset>
            ))}
            {submitted && validation.firstIssue && (
              <p role="alert" className="text-text-destructive">
                {validationMessage(validation.firstIssue.code)}
              </p>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
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
