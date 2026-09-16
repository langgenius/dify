'use client'

import type {
  ResourceAccessTokenResourcePayload,
  ResourceAccessTokenRowResponse,
} from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import copy from 'copy-to-clipboard'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/console'

const PAGE_SIZE = 20

type DialogState =
  | {
      mode: 'create'
    }
  | {
      mode: 'edit'
      row: TokenTableRow
    }
  | null

type ResourceCandidate = ResourceAccessTokenResourcePayload & {
  name: string
}

type ResourceTab = 'all' | 'app' | 'knowledge'

type TokenTableRow = {
  tokenId: string
  name: string
  trackId: string
  maskedToken: string
  createdAt?: number | null
  relations: ResourceAccessTokenRowResponse[]
}

const candidateKey = (candidate: ResourceAccessTokenResourcePayload) =>
  `${candidate.type}:${candidate.id}`

const rowResourceKey = (row: ResourceAccessTokenRowResponse) =>
  candidateKey({
    id: row.resource_id,
    type: row.resource_type,
  })

const formatTime = (timestamp?: number | null) => {
  if (!timestamp) return '-'

  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const formatTrackingId = (trackId: string) => {
  if (trackId.length <= 8) return trackId

  return `${trackId.slice(0, 8)} ...`
}

const getTokenRows = (rows: ResourceAccessTokenRowResponse[]) => {
  const rowMap = new Map<string, TokenTableRow>()

  rows.forEach((row) => {
    const tokenRow = rowMap.get(row.token_id)
    if (tokenRow) {
      tokenRow.relations.push(row)
      return
    }

    rowMap.set(row.token_id, {
      tokenId: row.token_id,
      name: row.name,
      trackId: row.track_id,
      maskedToken: row.masked_token,
      createdAt: row.created_at,
      relations: [row],
    })
  })

  return Array.from(rowMap.values())
}

const getResourceSummary = (
  relations: ResourceAccessTokenRowResponse[],
  t: ReturnType<typeof useTranslation>['t'],
) => {
  const appCount = relations.filter((relation) => relation.resource_type === 'app').length
  const knowledgeCount = relations.filter(
    (relation) => relation.resource_type === 'knowledge',
  ).length
  const parts: string[] = []

  if (appCount)
    parts.push(
      t(
        ($) => $[appCount === 1 ? 'resourceAccessToken.appCount' : 'resourceAccessToken.appsCount'],
        { ns: 'common', count: appCount },
      ),
    )
  if (knowledgeCount)
    parts.push(
      t(
        ($) =>
          $[
            knowledgeCount === 1
              ? 'resourceAccessToken.knowledgeCount'
              : 'resourceAccessToken.knowledgesCount'
          ],
        { ns: 'common', count: knowledgeCount },
      ),
    )

  return parts.join(' · ')
}

function useInvalidateResourceAccessTokens() {
  const queryClient = useQueryClient()

  return () =>
    queryClient.invalidateQueries({
      queryKey: consoleQuery.resourceAccessTokens.get.key(),
    })
}

function ResourceAccessTokenDialog({
  open,
  state,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  state: DialogState
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const isCreate = state?.mode === 'create'
  const isEdit = state?.mode === 'edit'
  const [name, setName] = useState(isEdit ? state.row.name : '')
  const [selectedResources, setSelectedResources] = useState<Set<string>>(
    () => new Set(isEdit ? state.row.relations.map(rowResourceKey) : []),
  )
  const [resourceTab, setResourceTab] = useState<ResourceTab>('all')
  const [resourceSearchText, setResourceSearchText] = useState('')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const invalidateResourceAccessTokens = useInvalidateResourceAccessTokens()
  const createMutation = useMutation(consoleQuery.resourceAccessTokens.post.mutationOptions())
  const updateMutation = useMutation(
    consoleQuery.resourceAccessTokens.byTokenId.patch.mutationOptions(),
  )
  const appsQuery = useQuery(
    consoleQuery.apps.get.queryOptions({
      enabled: isCreate || isEdit,
      input: {
        query: {
          limit: 100,
          page: 1,
        },
      },
    }),
  )
  const datasetsQuery = useQuery(
    consoleQuery.datasets.get.queryOptions({
      enabled: isCreate || isEdit,
      input: {
        query: {
          include_all: true,
          limit: 100,
          page: 1,
        },
      },
    }),
  )
  const selectedRelationCandidates = useMemo<ResourceCandidate[]>(
    () =>
      isEdit
        ? state.row.relations.map((relation) => ({
            id: relation.resource_id,
            name: relation.resource_name,
            type: relation.resource_type,
          }))
        : [],
    [isEdit, state],
  )
  const appCandidates = useMemo<ResourceCandidate[]>(() => {
    const candidates: ResourceCandidate[] =
      appsQuery.data?.data.map((app) => ({
        id: app.id,
        name: app.name,
        type: 'app' as const,
      })) ?? []

    selectedRelationCandidates
      .filter((candidate) => candidate.type === 'app')
      .forEach((candidate) => {
        if (!candidates.some((item) => item.id === candidate.id)) candidates.push(candidate)
      })

    return candidates
  }, [appsQuery.data?.data, selectedRelationCandidates])
  const knowledgeCandidates = useMemo<ResourceCandidate[]>(() => {
    const candidates: ResourceCandidate[] =
      datasetsQuery.data?.data
        .filter((dataset) => dataset.enable_api)
        .map((dataset) => ({
          id: dataset.id,
          name: dataset.name,
          type: 'knowledge' as const,
        })) ?? []

    selectedRelationCandidates
      .filter((candidate) => candidate.type === 'knowledge')
      .forEach((candidate) => {
        if (!candidates.some((item) => item.id === candidate.id)) candidates.push(candidate)
      })

    return candidates
  }, [datasetsQuery.data?.data, selectedRelationCandidates])
  const resourceCandidates = useMemo(
    () => [...appCandidates, ...knowledgeCandidates],
    [appCandidates, knowledgeCandidates],
  )
  const filteredAppCandidates = useMemo(() => {
    const keyword = resourceSearchText.trim().toLowerCase()
    if (!keyword) return appCandidates

    return appCandidates.filter((candidate) => candidate.name.toLowerCase().includes(keyword))
  }, [appCandidates, resourceSearchText])
  const filteredKnowledgeCandidates = useMemo(() => {
    const keyword = resourceSearchText.trim().toLowerCase()
    if (!keyword) return knowledgeCandidates

    return knowledgeCandidates.filter((candidate) => candidate.name.toLowerCase().includes(keyword))
  }, [knowledgeCandidates, resourceSearchText])
  const isSaving = createMutation.isPending || updateMutation.isPending
  const nameLabel = t(($) => $['resourceAccessToken.name'], { ns: 'common' })

  const toggleResource = (candidate: ResourceCandidate) => {
    const key = candidateKey(candidate)
    setSelectedResources((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderCandidate = (candidate: ResourceCandidate) => {
    const key = candidateKey(candidate)

    return (
      <div
        key={key}
        className="flex min-h-10 w-full items-center gap-3 border-b border-divider-subtle px-3 text-left last:border-b-0 hover:bg-state-base-hover"
      >
        <Checkbox
          checked={selectedResources.has(key)}
          aria-label={candidate.name}
          onCheckedChange={() => toggleResource(candidate)}
        />
        <span
          aria-hidden
          className={
            candidate.type === 'app'
              ? 'i-ri-apps-2-line size-4 text-text-tertiary'
              : 'i-ri-book-2-line size-4 text-text-tertiary'
          }
        />
        <span className="min-w-0 flex-1 truncate system-sm-medium text-text-primary">
          {candidate.name}
        </span>
        <span className="system-xs-medium-uppercase text-text-tertiary">
          {candidate.type === 'app'
            ? t(($) => $['resourceAccessToken.app'], { ns: 'common' })
            : t(($) => $['resourceAccessToken.knowledge'], { ns: 'common' })}
        </span>
      </div>
    )
  }

  const renderCandidateSection = (title: string, candidates: ResourceCandidate[]) => {
    if (!candidates.length) return null

    return (
      <div>
        <div className="flex h-8 items-center border-b border-divider-subtle px-3 system-xs-medium-uppercase text-text-tertiary">
          {title}
        </div>
        {candidates.map(renderCandidate)}
      </div>
    )
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) return

    const resources = resourceCandidates.filter((candidate) =>
      selectedResources.has(candidateKey(candidate)),
    )
    if (!resources.length) return

    if (isEdit) {
      updateMutation.mutate(
        {
          body: {
            name: normalizedName,
            resources: resources.map(({ id, type }) => ({ id, type })),
          },
          params: {
            token_id: state.row.tokenId,
          },
        },
        {
          onSuccess: () => {
            toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
            void invalidateResourceAccessTokens()
            onSaved()
          },
        },
      )
      return
    }

    createMutation.mutate(
      {
        body: {
          name: normalizedName,
          resources: resources.map(({ id, type }) => ({ id, type })),
        },
      },
      {
        onSuccess: (result) => {
          toast.success(t(($) => $['resourceAccessToken.created'], { ns: 'common' }))
          void invalidateResourceAccessTokens()
          setCreatedToken(result.token)
        },
      },
    )
  }

  const copyCreatedToken = () => {
    if (!createdToken) return

    copy(createdToken)
    toast.success(t(($) => $['resourceAccessToken.copied'], { ns: 'common' }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-160 border-none p-8 pb-6 text-left"
      >
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <DialogTitle className="mb-5 pr-8 text-xl font-semibold text-text-primary">
          {isEdit
            ? t(($) => $['resourceAccessToken.editTitle'], { ns: 'common' })
            : createdToken
              ? t(($) => $['resourceAccessToken.createdToken'], { ns: 'common' })
              : t(($) => $['resourceAccessToken.createTitle'], { ns: 'common' })}
        </DialogTitle>

        {createdToken ? (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <div className="system-sm-regular text-text-tertiary">
                {t(($) => $['resourceAccessToken.createdTokenDescription'], { ns: 'common' })}
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-components-panel-border bg-components-input-bg-normal p-2">
                <code className="min-w-0 flex-1 truncate px-1 font-mono text-sm text-text-primary">
                  {createdToken}
                </code>
                <IconButton
                  size="md"
                  aria-label={t(($) => $['operation.copy'], { ns: 'common' })}
                  onClick={copyCreatedToken}
                >
                  <span aria-hidden className="i-ri-file-copy-line size-4" />
                </IconButton>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>
                {t(($) => $['resourceAccessToken.done'], { ns: 'common' })}
              </Button>
            </div>
          </div>
        ) : (
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <Field name="name">
              <FieldLabel>{nameLabel}</FieldLabel>
              <Input
                required
                value={name}
                placeholder={t(($) => $['resourceAccessToken.namePlaceholder'], { ns: 'common' })}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldError match="valueMissing">
                {t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: nameLabel })}
              </FieldError>
            </Field>

            {(isCreate || isEdit) && (
              <div className="grid gap-2">
                <div className="system-sm-medium text-text-secondary">
                  {t(($) => $['resourceAccessToken.resources'], { ns: 'common' })}
                </div>
                <div className="grid gap-3">
                  <SearchInput
                    value={resourceSearchText}
                    onValueChange={setResourceSearchText}
                    placeholder={t(($) => $['resourceAccessToken.searchResourcesPlaceholder'], {
                      ns: 'common',
                    })}
                  />
                  <Tabs
                    value={resourceTab}
                    onValueChange={(value) => setResourceTab(value as ResourceTab)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <TabsList className="gap-5">
                        <TabsTab value="all" className="py-1.5 system-sm-semibold">
                          {t(($) => $['resourceAccessToken.tabAll'], { ns: 'common' })}
                        </TabsTab>
                        <TabsTab value="app" className="py-1.5 system-sm-semibold">
                          {t(($) => $['resourceAccessToken.tabApps'], { ns: 'common' })}
                        </TabsTab>
                        <TabsTab value="knowledge" className="py-1.5 system-sm-semibold">
                          {t(($) => $['resourceAccessToken.tabKnowledgeBases'], { ns: 'common' })}
                        </TabsTab>
                      </TabsList>
                      <div className="rounded-full bg-state-accent-hover px-3 py-1 system-sm-semibold text-text-accent">
                        {t(($) => $['dynamicSelect.selected'], {
                          ns: 'common',
                          count: selectedResources.size,
                        })}
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-components-panel-border">
                      {(appsQuery.isPending || datasetsQuery.isPending) && (
                        <div className="grid gap-2 p-3">
                          <SkeletonRectangle className="h-8 w-full animate-pulse" />
                          <SkeletonRectangle className="h-8 w-full animate-pulse" />
                          <SkeletonRectangle className="h-8 w-full animate-pulse" />
                        </div>
                      )}
                      {!appsQuery.isPending && !datasetsQuery.isPending && (
                        <>
                          <TabsPanel value="all">
                            {renderCandidateSection(
                              t(($) => $['resourceAccessToken.appsSection'], { ns: 'common' }),
                              filteredAppCandidates,
                            )}
                            {renderCandidateSection(
                              t(($) => $['resourceAccessToken.knowledgeBasesSection'], {
                                ns: 'common',
                              }),
                              filteredKnowledgeCandidates,
                            )}
                          </TabsPanel>
                          <TabsPanel value="app">
                            {filteredAppCandidates.map(renderCandidate)}
                          </TabsPanel>
                          <TabsPanel value="knowledge">
                            {filteredKnowledgeCandidates.map(renderCandidate)}
                          </TabsPanel>
                        </>
                      )}
                      {!appsQuery.isPending &&
                        !datasetsQuery.isPending &&
                        ((resourceTab === 'all' &&
                          filteredAppCandidates.length === 0 &&
                          filteredKnowledgeCandidates.length === 0) ||
                          (resourceTab === 'app' && filteredAppCandidates.length === 0) ||
                          (resourceTab === 'knowledge' &&
                            filteredKnowledgeCandidates.length === 0)) && (
                          <div className="p-6 text-center system-sm-regular text-text-tertiary">
                            {resourceCandidates.length === 0
                              ? t(($) => $['resourceAccessToken.noResources'], { ns: 'common' })
                              : t(($) => $['resourceAccessToken.noResourceSearchResults'], {
                                  ns: 'common',
                                })}
                          </div>
                        )}
                    </div>
                  </Tabs>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  isSaving ||
                  !name.trim() ||
                  selectedResources.size === 0 ||
                  resourceCandidates.length === 0
                }
              >
                {isEdit
                  ? t(($) => $['operation.save'], { ns: 'common' })
                  : t(($) => $['operation.create'], { ns: 'common' })}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ResourceAccessTokenRow({
  row,
  onEdit,
  onDelete,
}: {
  row: TokenTableRow
  onEdit: (row: TokenTableRow) => void
  onDelete: (row: ResourceAccessTokenRowResponse) => void
}) {
  const { t } = useTranslation()
  const editRow = row.relations[0]
  const resourceSummary = getResourceSummary(row.relations, t)

  if (!editRow) return null

  return (
    <div className="grid min-h-12 grid-cols-[minmax(140px,1.15fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(180px,1.2fr)_minmax(120px,0.8fr)_80px] items-center gap-6 border-b border-divider-subtle text-sm last:border-b-0">
      <div className="min-w-0 truncate font-medium text-text-primary">{row.name}</div>
      <div className="min-w-0 truncate font-mono text-[13px] text-text-secondary">
        {formatTrackingId(row.trackId)}
      </div>
      <div className="min-w-0 truncate font-mono text-[13px] text-text-primary">
        {row.maskedToken}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 truncate text-text-secondary">
          {resourceSummary ||
            t(($) => $['resourceAccessToken.noAccessibleResources'], { ns: 'common' })}
        </div>
        <Infotip
          iconVariant="information"
          aria-label={`${row.name} · ${t(($) => $['resourceAccessToken.accessibleResources'], { ns: 'common' })}`}
        >
          <div className="grid max-h-60 min-w-48 gap-3 overflow-y-auto">
            {(['app', 'knowledge'] as const).map((type) => {
              const resources = row.relations.filter((relation) => relation.resource_type === type)
              if (resources.length === 0) return null
              const label = t(
                ($) =>
                  $[
                    type === 'app'
                      ? 'resourceAccessToken.appsSection'
                      : 'resourceAccessToken.knowledgeBasesSection'
                  ],
                { ns: 'common' },
              )
              return (
                <div key={type}>
                  <div className="mb-1 system-xs-semibold text-text-secondary">{label}</div>
                  <ul aria-label={label} className="grid gap-1">
                    {resources.map((resource) => (
                      <li key={resource.relation_id} className="wrap-break-word">
                        {resource.resource_name || resource.resource_id}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </Infotip>
      </div>
      <div className="min-w-0 truncate text-text-secondary">{formatTime(row.createdAt)}</div>
      <div className="flex items-center gap-1 text-text-tertiary">
        <IconButton
          size="sm"
          variant="tertiary"
          aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
          onClick={() => onEdit(row)}
        >
          <span aria-hidden className="i-ri-edit-line size-4" />
        </IconButton>
        <IconButton
          size="sm"
          variant="tertiary"
          aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
          onClick={() => onDelete(editRow)}
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </IconButton>
      </div>
    </div>
  )
}

export default function ResourceAccessTokenPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [searchText, setSearchText] = useState('')
  const [dialogState, setDialogState] = useState<DialogState>(null)
  const [deletingRow, setDeletingRow] = useState<ResourceAccessTokenRowResponse | null>(null)
  const invalidateResourceAccessTokens = useInvalidateResourceAccessTokens()
  const deleteMutation = useMutation(
    consoleQuery.resourceAccessTokens.byTokenId.relations.byRelationId.delete.mutationOptions(),
  )
  const tokensQuery = useQuery(
    consoleQuery.resourceAccessTokens.get.queryOptions({
      input: {
        query: {
          limit: PAGE_SIZE,
          page,
        },
      },
    }),
  )
  const rows = tokensQuery.data?.data
  const total = tokensQuery.data?.total ?? 0
  const tokenRows = useMemo(() => getTokenRows(rows ?? []), [rows])
  const isEmptyList = !tokensQuery.isPending && total === 0 && !searchText.trim()
  const filteredRows = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return tokenRows

    return tokenRows.filter((row) => {
      const searchableText = [
        row.name,
        row.trackId,
        row.maskedToken,
        ...row.relations.map((relation) => relation.resource_name),
      ]
        .join(' ')
        .toLowerCase()

      return searchableText.includes(keyword)
    })
  }, [searchText, tokenRows])

  const confirmDelete = () => {
    if (!deletingRow) return

    deleteMutation.mutate(
      {
        params: {
          relation_id: deletingRow.relation_id,
          token_id: deletingRow.token_id,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['resourceAccessToken.deleted'], { ns: 'common' }))
          setDeletingRow(null)
          void invalidateResourceAccessTokens()
        },
      },
    )
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          className="w-80"
          placeholder={t(($) => $['resourceAccessToken.searchPlaceholder'], { ns: 'common' })}
          value={searchText}
          onValueChange={setSearchText}
        />
        <Button variant="primary" onClick={() => setDialogState({ mode: 'create' })}>
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['resourceAccessToken.createButton'], { ns: 'common' })}
        </Button>
      </div>

      {isEmptyList ? (
        <div className="flex min-h-[360px] items-center justify-center text-center">
          <div className="grid max-w-[520px] gap-3">
            <div className="title-md-semi-bold text-text-primary">
              {t(($) => $['resourceAccessToken.empty'], { ns: 'common' })}
            </div>
            <div className="system-md-regular text-text-tertiary">
              {t(($) => $['resourceAccessToken.emptyDescription'], { ns: 'common' })}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[900px] grid-cols-[minmax(140px,1.15fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(180px,1.2fr)_minmax(120px,0.8fr)_80px] gap-6 border-b border-divider-subtle pb-3 system-xs-medium-uppercase text-text-tertiary">
            <div>{t(($) => $['resourceAccessToken.name'], { ns: 'common' })}</div>
            <div>{t(($) => $['resourceAccessToken.trackingId'], { ns: 'common' })}</div>
            <div>{t(($) => $['resourceAccessToken.token'], { ns: 'common' })}</div>
            <div>{t(($) => $['resourceAccessToken.accessibleResources'], { ns: 'common' })}</div>
            <div>{t(($) => $['resourceAccessToken.createdColumn'], { ns: 'common' })}</div>
            <div>{t(($) => $['resourceAccessToken.actions'], { ns: 'common' })}</div>
          </div>

          {tokensQuery.isPending && (
            <div className="grid gap-2 py-4">
              <SkeletonRectangle className="h-12 w-full animate-pulse" />
              <SkeletonRectangle className="h-12 w-full animate-pulse" />
            </div>
          )}
          {!tokensQuery.isPending &&
            filteredRows.map((row) => (
              <ResourceAccessTokenRow
                key={row.tokenId}
                row={row}
                onEdit={(row) => setDialogState({ mode: 'edit', row })}
                onDelete={setDeletingRow}
              />
            ))}
          {!tokensQuery.isPending && filteredRows.length === 0 && (
            <div className="p-10 text-center system-sm-regular text-text-tertiary">
              {t(($) => $['resourceAccessToken.empty'], { ns: 'common' })}
            </div>
          )}
        </div>
      )}

      {!isEmptyList && (
        <div className="flex items-center justify-between system-xs-regular text-text-tertiary">
          <span>{t(($) => $['resourceAccessToken.total'], { ns: 'common', total })}</span>
          <div className="flex items-center gap-2">
            <Button size="small" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              {t(($) => $['resourceAccessToken.previous'], { ns: 'common' })}
            </Button>
            <span>{page}</span>
            <Button
              size="small"
              disabled={!tokensQuery.data?.has_more}
              onClick={() => setPage((value) => value + 1)}
            >
              {t(($) => $['resourceAccessToken.next'], { ns: 'common' })}
            </Button>
          </div>
        </div>
      )}

      {dialogState && (
        <ResourceAccessTokenDialog
          open
          state={dialogState}
          onOpenChange={(open) => !open && setDialogState(null)}
          onSaved={() => {
            setDialogState(null)
          }}
        />
      )}

      <Dialog open={!!deletingRow} onOpenChange={(open) => !open && setDeletingRow(null)}>
        <DialogContent className="w-120 p-6 text-left" backdropProps={{ forceRender: true }}>
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['resourceAccessToken.deleteTitle'], { ns: 'common' })}
          </DialogTitle>
          <div className="mt-2 system-sm-regular text-text-tertiary">
            {t(($) => $['resourceAccessToken.deleteDescription'], { ns: 'common' })}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setDeletingRow(null)}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button
              variant="primary"
              tone="destructive"
              disabled={deleteMutation.isPending}
              onClick={confirmDelete}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
