'use client'

import type { GraphEntityResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { SearchInput } from '@/app/components/base/search-input'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { describeRequestError } from './describe-request-error'
import EntityList from './entity-list'
import { BuildingBanner, ExtractionWarning, GraphNotice } from './graph-status'
import GraphView from './graph-view'
import StatsBar from './stats-bar'

const SUBGRAPH_LIMIT = 50
// Extraction runs in a background worker; poll while it is in progress.
const BUILD_POLL_MS = 3000

type KnowledgeGraphProps = {
  datasetId: string
}

const KnowledgeGraph = ({ datasetId }: KnowledgeGraphProps) => {
  const { t } = useTranslation(['datasetSettings'])
  const router = useRouter()
  const dataset = useDatasetDetailContextWithSelector((state) => state.dataset)
  const graphEnabled = !!dataset?.graph_index_setting?.enabled

  const [searchValue, setSearchValue] = useState('')
  const [focusedEntity, setFocusedEntity] = useState<GraphEntityResponse | undefined>()

  // Clicking a node re-centres the subgraph on it, which is how you walk
  // outwards from a single entity without typing its neighbours by hand.
  const query = focusedEntity?.display_name || searchValue

  const {
    data: stats,
    isLoading: isStatsLoading,
    isError: isStatsError,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    ...consoleQuery.datasets.byDatasetId.graph.stats.get.queryOptions({
      input: { params: { dataset_id: datasetId } },
    }),
    enabled: graphEnabled,
    refetchInterval: (statsQuery) => (statsQuery.state.data?.building ? BUILD_POLL_MS : false),
  })
  const isBuilding = !!stats?.building
  const {
    data: graph,
    isLoading: isGraphLoading,
    isError: isGraphError,
    error: graphError,
    refetch: refetchGraph,
  } = useQuery({
    // `query` is part of the query key, so changing the focus refetches rather
    // than leaving the previous subgraph on screen.
    ...consoleQuery.datasets.byDatasetId.graph.get.queryOptions({
      input: {
        params: { dataset_id: datasetId },
        query: { ...(query ? { query } : {}), limit: SUBGRAPH_LIMIT },
      },
    }),
    enabled: graphEnabled,
    // New entities appear as each batch lands, so follow the build live.
    refetchInterval: isBuilding ? BUILD_POLL_MS : false,
  })

  // The last poll can land before the final batch is written; refresh once
  // more when the build finishes so the view matches the stats.
  const wasBuilding = useRef(false)
  useEffect(() => {
    if (wasBuilding.current && !isBuilding) refetchGraph()
    wasBuilding.current = isBuilding
  }, [isBuilding, refetchGraph])

  const { mutate: retryGraph, isPending: isRetrying } = useMutation({
    ...consoleQuery.datasets.byDatasetId.graph.retry.post.mutationOptions(),
    // The retry marks the build active, so refetching flips the page to its
    // building state and starts polling.
    onSuccess: () => refetchStats(),
  })
  const handleRetry = () => retryGraph({ params: { dataset_id: datasetId } })
  const retryButton = (
    <Button variant="primary" loading={isRetrying} disabled={isRetrying} onClick={handleRetry}>
      {t(($) => $['graph.retry'], { ns: 'datasetSettings' })}
    </Button>
  )

  const entities = useMemo(() => graph?.entities ?? [], [graph])
  const relations = useMemo(() => graph?.relations ?? [], [graph])
  const hasGraph = (stats?.entity_count ?? 0) > 0
  const failedChunkCount = stats?.failed_chunk_count ?? 0

  const handleSearchChange = (value: string) => {
    setSearchValue(value)
    // Typing a new search replaces the click-driven focus.
    setFocusedEntity(undefined)
  }

  const handleEntityClick = (entity: GraphEntityResponse) => {
    setFocusedEntity(entity)
    setSearchValue('')
  }

  const handleResetFocus = () => {
    setFocusedEntity(undefined)
    setSearchValue('')
  }

  if (!graphEnabled) {
    return (
      <GraphNotice
        title={t(($) => $['graph.disabledTitle'], { ns: 'datasetSettings' })}
        description={t(($) => $['graph.disabledDescription'], { ns: 'datasetSettings' })}
        action={
          <Button variant="primary" onClick={() => router.push(`/datasets/${datasetId}/settings`)}>
            {t(($) => $['graph.goToSettings'], { ns: 'datasetSettings' })}
          </Button>
        }
      />
    )
  }

  if (isStatsLoading) return <LoadingPlaceholder className="h-full" />

  // A failed request says nothing about the graph, so it must not read as
  // "no graph yet".
  if (isStatsError) {
    return (
      <GraphNotice
        title={t(($) => $['graph.loadFailedTitle'], { ns: 'datasetSettings' })}
        description={t(($) => $['graph.loadFailedDescription'], { ns: 'datasetSettings' })}
        detail={describeRequestError(statsError)}
        action={
          <Button variant="secondary" onClick={() => refetchStats()}>
            {t(($) => $['graph.retry'], { ns: 'datasetSettings' })}
          </Button>
        }
      />
    )
  }

  // Documents are still indexing or a rebuild is running: an empty graph is
  // not a result yet.
  if (!hasGraph && isBuilding) {
    return (
      <GraphNotice
        busy
        title={t(($) => $['graph.buildingTitle'], { ns: 'datasetSettings' })}
        description={t(($) => $['graph.buildingDescription'], { ns: 'datasetSettings' })}
      />
    )
  }

  if (!hasGraph && failedChunkCount > 0) {
    return (
      <GraphNotice
        title={t(($) => $['graph.extractionFailedTitle'], { ns: 'datasetSettings' })}
        description={t(($) => $['graph.extractionFailedDescription'], {
          ns: 'datasetSettings',
          count: failedChunkCount,
        })}
        detail={stats?.last_error}
        action={
          <div className="flex gap-x-2">
            {retryButton}
            <Button
              variant="secondary"
              onClick={() => router.push(`/datasets/${datasetId}/settings`)}
            >
              {t(($) => $['graph.goToSettings'], { ns: 'datasetSettings' })}
            </Button>
          </div>
        }
      />
    )
  }

  if (!hasGraph) {
    return (
      <GraphNotice
        title={t(($) => $['graph.emptyTitle'], { ns: 'datasetSettings' })}
        description={t(($) => $['graph.emptyDescription'], { ns: 'datasetSettings' })}
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-y-3 p-6">
      {isBuilding ? (
        <BuildingBanner
          label={t(($) => $['graph.buildingDescription'], { ns: 'datasetSettings' })}
        />
      ) : (
        failedChunkCount > 0 && (
          <ExtractionWarning
            summary={t(($) => $['graph.partialFailure'], {
              ns: 'datasetSettings',
              count: failedChunkCount,
            })}
            detail={stats?.last_error}
            action={retryButton}
          />
        )
      )}
      <StatsBar stats={stats} />

      <div className="flex items-center gap-x-2">
        <SearchInput
          className="w-80"
          value={searchValue}
          onValueChange={handleSearchChange}
          placeholder={t(($) => $['graph.searchPlaceholder'], { ns: 'datasetSettings' })}
          aria-label={t(($) => $['graph.searchPlaceholder'], { ns: 'datasetSettings' })}
        />
        {!!focusedEntity && (
          <div className="flex items-center gap-x-2 system-xs-regular text-text-tertiary">
            <span className="truncate">
              {t(($) => $['graph.focusedOn'], {
                ns: 'datasetSettings',
                name: focusedEntity.display_name,
              })}
            </span>
            <Button size="small" variant="ghost" onClick={handleResetFocus}>
              {t(($) => $['graph.clearFocus'], { ns: 'datasetSettings' })}
            </Button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 grow gap-x-3">
        <div
          className={cn(
            'relative min-w-0 grow rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg',
          )}
        >
          {isGraphLoading ? (
            <LoadingPlaceholder className="h-full" />
          ) : isGraphError ? (
            <GraphNotice
              title={t(($) => $['graph.loadFailedTitle'], { ns: 'datasetSettings' })}
              description={t(($) => $['graph.loadFailedDescription'], { ns: 'datasetSettings' })}
              detail={describeRequestError(graphError)}
              action={
                <Button variant="secondary" onClick={() => refetchGraph()}>
                  {t(($) => $['graph.retry'], { ns: 'datasetSettings' })}
                </Button>
              }
            />
          ) : entities.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center system-sm-regular text-text-tertiary">
              {t(($) => $['graph.noMatch'], { ns: 'datasetSettings' })}
            </div>
          ) : (
            <GraphView
              entities={entities}
              relations={relations}
              focusedEntityName={focusedEntity?.name}
              onEntityClick={handleEntityClick}
            />
          )}
        </div>

        <EntityList
          entities={entities}
          focusedEntityId={focusedEntity?.id}
          onEntityClick={handleEntityClick}
        />
      </div>
    </div>
  )
}

export default KnowledgeGraph
