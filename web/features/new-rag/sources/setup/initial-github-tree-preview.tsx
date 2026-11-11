'use client'

import type {
  ConnectedSourceConfigurationBinding,
  ConnectedSourceSelection,
  PreviewResource,
} from './connected-source-selection'
import type { DatasourceParameters } from './datasource-parameter-model'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { consoleClient } from '@/service/console'

type DocumentResource = Extract<PreviewResource, { kind: 'document' }>
type Branch = {
  error: boolean
  loaded: boolean
  loading: boolean
  nextCursor: string | null
  requestedCursors: string[]
  resources: DocumentResource[]
}
type Row =
  | { kind: 'document'; resource: DocumentResource }
  | { kind: 'loadMore'; depth: number; parentKey: string }

const ROOT = 'root'
const ROOT_PAGE_SIZE = 10
const CHILD_PAGE_SIZE = 30
const DIRECTORY_PAGE_SIZE = 100
const MAX_SELECTION = 200
const SELECTION_LIMIT_ID = 'create-github-source-selection-limit'

function isNavigationOnly(resource: DocumentResource) {
  return (
    resource.document.type === 'github_collection' || resource.document.type === 'github_directory'
  )
}

function resourceIcon(resource: DocumentResource) {
  return resource.document.type === 'repository' || isNavigationOnly(resource)
    ? 'i-ri-folder-3-fill text-text-warning'
    : 'i-ri-file-text-line text-text-tertiary'
}

export function InitialGitHubTreePreview({
  binding,
  disabled,
  parameters,
  selectedResources,
  onSelectionChange,
}: {
  binding: ConnectedSourceConfigurationBinding
  disabled: boolean
  parameters: DatasourceParameters
  selectedResources: ConnectedSourceSelection
  onSelectionChange: (selection: ConnectedSourceSelection) => void
}) {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeSources', 'common'])
  const [branches, setBranches] = useState<ReadonlyMap<string, Branch>>(() => new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const root = branches.get(ROOT)
  const allResources = [
    ...new Map(
      [...branches.values()]
        .flatMap((branch) => branch.resources)
        .map((resource) => [resource.key, resource]),
    ).values(),
  ]
  const selectable = allResources.filter((resource) => !isNavigationOnly(resource))
  const selected = new Set(selectedResources.map((resource) => resource.key))
  const selectionAtLimit = selected.size >= MAX_SELECTION

  const updateSelection = (keys: Set<string>) => {
    onSelectionChange(allResources.filter((resource) => keys.has(resource.key)))
  }

  const loadBranch = async (parent?: DocumentResource, cursor?: string) => {
    const scope = parent?.key ?? ROOT
    const prior = branches.get(scope)
    if (prior?.loading || (cursor && prior?.requestedCursors.includes(cursor))) return
    if (!parent && !cursor) {
      setExpanded(new Set())
      onSelectionChange([])
    }
    setBranches((current) =>
      new Map(current).set(scope, {
        error: false,
        loaded: prior?.loaded ?? false,
        loading: true,
        nextCursor: prior?.nextCursor ?? null,
        requestedCursors: prior?.requestedCursors ?? [],
        resources: prior?.resources ?? [],
      }),
    )
    try {
      const response = await consoleClient.knowledgeFs.sourceProviderPreview.post({
        body: {
          credentialId: binding.credentialId,
          datasource: binding.datasource,
          kind: 'online_document',
          parameters: {
            ...parameters,
            view: 'tree',
            limit: parent
              ? parent.document.type === 'github_directory' ||
                parent.document.page_id.startsWith('contents:')
                ? DIRECTORY_PAGE_SIZE
                : CHILD_PAGE_SIZE
              : ROOT_PAGE_SIZE,
            ...(parent ? { parent_id: parent.document.page_id } : {}),
            ...(cursor ? { cursor } : {}),
          },
          pluginId: binding.pluginId,
          provider: binding.provider,
        },
      })
      const resources: DocumentResource[] = (response.documents ?? []).map((document) => ({
        depth: parent ? parent.depth + 1 : 0,
        document,
        key: `document:${document.provider_item_id}`,
        kind: 'document',
        parentKey: parent?.key,
      }))
      setBranches((current) => {
        const existing = current.get(scope)
        const merged = new Map(
          (cursor ? (existing?.resources ?? []) : []).map((item) => [item.key, item]),
        )
        for (const resource of resources) merged.set(resource.key, resource)
        const requestedCursors = cursor ? [...(existing?.requestedCursors ?? []), cursor] : []
        const nextCursor = response.next_cursor
        return new Map(current).set(scope, {
          error: false,
          loaded: true,
          loading: false,
          nextCursor: nextCursor && !requestedCursors.includes(nextCursor) ? nextCursor : null,
          requestedCursors,
          resources: [...merged.values()],
        })
      })
    } catch {
      setBranches((current) => {
        const existing = current.get(scope)
        return new Map(current).set(scope, {
          error: true,
          loaded: existing?.loaded ?? false,
          loading: false,
          nextCursor: existing?.nextCursor ?? null,
          requestedCursors: existing?.requestedCursors ?? [],
          resources: existing?.resources ?? [],
        })
      })
    }
  }

  const loadedDescendants = (resource: DocumentResource) => {
    const result: DocumentResource[] = []
    const pending = [...(branches.get(resource.key)?.resources ?? [])]
    const seen = new Set<string>()
    while (pending.length) {
      const child = pending.shift()
      if (!child || seen.has(child.key)) continue
      seen.add(child.key)
      result.push(child)
      pending.push(...(branches.get(child.key)?.resources ?? []))
    }
    return result.filter((child) => !isNavigationOnly(child))
  }

  const toggle = (resource: DocumentResource) => {
    const targets = [
      ...(!isNavigationOnly(resource) ? [resource] : []),
      ...loadedDescendants(resource),
    ]
    if (!targets.length) return
    const next = new Set(selected)
    if (targets.every((target) => next.has(target.key))) {
      for (const target of targets) next.delete(target.key)
    } else {
      for (const target of targets) {
        if (next.size >= MAX_SELECTION) break
        next.add(target.key)
      }
    }
    updateSelection(next)
  }

  const toggleAll = () => {
    const next = new Set(selected)
    if (selectable.length && selectable.every((resource) => next.has(resource.key))) {
      for (const resource of selectable) next.delete(resource.key)
    } else {
      for (const resource of selectable) {
        if (next.size >= MAX_SELECTION) break
        next.add(resource.key)
      }
    }
    updateSelection(next)
  }

  const toggleExpanded = (resource: DocumentResource) => {
    const opening = !expanded.has(resource.key)
    setExpanded((current) => {
      const next = new Set(current)
      if (opening) next.add(resource.key)
      else next.delete(resource.key)
      return next
    })
    if (opening && !branches.get(resource.key)?.loaded && !branches.get(resource.key)?.loading)
      void loadBranch(resource)
  }

  const rows: Row[] = []
  const appendRows = (scope: string, depth: number) => {
    const branch = branches.get(scope)
    for (const resource of branch?.resources ?? []) {
      rows.push({ kind: 'document', resource })
      if (expanded.has(resource.key)) appendRows(resource.key, depth + 1)
    }
    if (scope !== ROOT && branch?.nextCursor && !branch.loading && !branch.error)
      rows.push({ kind: 'loadMore', depth, parentKey: scope })
  }
  appendRows(ROOT, 0)

  const allSelected =
    selectable.length > 0 && selectable.every((resource) => selected.has(resource.key))
  const providerName = root?.resources[0]?.document.workspace_name || binding.providerDisplayName

  return (
    <>
      {!root?.loaded && !root?.loading && !root?.error && (
        <Button
          type="button"
          variant="primary"
          className="w-full"
          disabled={disabled}
          onClick={() => void loadBranch()}
        >
          {t(($) => $.preview)}
        </Button>
      )}
      {root?.loading && !root.loaded && (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-divider-subtle">
          <LoadingPlaceholder />
        </div>
      )}
      {root?.error && !root.loaded && (
        <div role="alert" className="rounded-lg bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">{t(($) => $.providerLoadFailed)}</p>
          <Button
            className="mt-3"
            type="button"
            disabled={disabled}
            onClick={() => void loadBranch()}
          >
            {t(($) => $.retryProviderLoad)}
          </Button>
        </div>
      )}
      {root?.loaded && (
        <section className="flex h-78 flex-col overflow-hidden rounded-xl border border-divider-regular">
          <div className="flex min-h-7.5 shrink-0 items-center gap-2 border-b border-divider-subtle px-3 py-1">
            <Checkbox
              aria-label={t(($) => $.selectAll, { ns: 'knowledgeSources' })}
              aria-describedby={selectionAtLimit && !allSelected ? SELECTION_LIMIT_ID : undefined}
              checked={allSelected}
              disabled={disabled || !selectable.length || (selectionAtLimit && !allSelected)}
              indeterminate={!allSelected && selected.size > 0}
              onCheckedChange={toggleAll}
            />
            <span className="system-xs-medium text-text-primary">
              {t(($) => $.selectAll, { ns: 'knowledgeSources' })}
            </span>
            <span className="ms-auto min-w-0 flex-1 text-end system-xs-regular break-words text-text-tertiary">
              {providerName}
            </span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-live="polite">
            {rows.map((row) => {
              if (row.kind === 'loadMore') {
                const parent = allResources.find((resource) => resource.key === row.parentKey)
                return (
                  <li
                    key={`load-more:${row.parentKey}`}
                    className="flex h-8.5 items-center pe-3"
                    style={{ paddingInlineStart: `${12 + row.depth * 26}px` }}
                  >
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => {
                        if (parent)
                          void loadBranch(parent, branches.get(parent.key)?.nextCursor ?? undefined)
                      }}
                    >
                      {t(($) => $.loadMore)}
                    </Button>
                  </li>
                )
              }
              const { resource } = row
              const branch = branches.get(resource.key)
              const targets = [
                ...(!isNavigationOnly(resource) ? [resource] : []),
                ...loadedDescendants(resource),
              ]
              const checked =
                targets.length > 0 && targets.every((target) => selected.has(target.key))
              const indeterminate = !checked && targets.some((target) => selected.has(target.key))
              const expandable = Boolean(resource.document.has_children)
              const isExpanded = expanded.has(resource.key)
              return (
                <li
                  key={resource.key}
                  className={`flex items-center gap-2 pe-3 ${expandable ? 'h-8.5' : 'h-7.5'}`}
                  style={{ paddingInlineStart: `${12 + resource.depth * 26}px` }}
                >
                  {expandable ? (
                    <button
                      type="button"
                      aria-label={resource.document.name}
                      aria-expanded={isExpanded}
                      className="flex size-5 items-center justify-center rounded text-text-tertiary hover:bg-state-base-hover"
                      disabled={disabled}
                      onClick={() => toggleExpanded(resource)}
                    >
                      <span
                        aria-hidden
                        className={`i-ri-arrow-right-s-line size-4 transition-transform motion-reduce:transition-none ${isExpanded ? 'rotate-90' : ''}`}
                      />
                    </button>
                  ) : (
                    <span className="size-5" />
                  )}
                  <Checkbox
                    aria-label={resource.document.name}
                    aria-describedby={selectionAtLimit && !checked ? SELECTION_LIMIT_ID : undefined}
                    checked={checked}
                    indeterminate={indeterminate}
                    disabled={disabled || !targets.length || (selectionAtLimit && !checked)}
                    onCheckedChange={() => toggle(resource)}
                  />
                  <span aria-hidden className={`${resourceIcon(resource)} size-4 shrink-0`} />
                  <span className="min-w-0 flex-1 truncate system-xs-regular text-text-primary">
                    {resource.document.name}
                  </span>
                  {isExpanded && branch?.loading && (
                    <span
                      role="status"
                      aria-label={t(($) => $.loading, { ns: 'common' })}
                      className="i-ri-loader-4-line size-4 animate-spin text-text-tertiary"
                    />
                  )}
                  {isExpanded && branch?.error && (
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        void loadBranch(
                          resource,
                          branch.loaded ? (branch.nextCursor ?? undefined) : undefined,
                        )
                      }
                    >
                      {t(($) => $.retryProviderLoad)}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          {root.nextCursor && !root.loading && (
            <div className="border-t border-divider-subtle px-3 py-2 text-center">
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={disabled}
                onClick={() => void loadBranch(undefined, root.nextCursor ?? undefined)}
              >
                {t(($) => (root.error ? $.retryProviderLoad : $.loadMore))}
              </Button>
            </div>
          )}
        </section>
      )}
      {root?.loaded && (
        <span role="status" className="system-xs-regular text-text-tertiary">
          {t(($) => $.pagesSelected, { ns: 'knowledgeSources', count: selected.size })}
          {selectionAtLimit && (
            <span id={SELECTION_LIMIT_ID} className="ms-2 text-text-destructive">
              {t(($) => $.maxPages, { ns: 'knowledgeSources' })}: {MAX_SELECTION}
            </span>
          )}
        </span>
      )}
    </>
  )
}
