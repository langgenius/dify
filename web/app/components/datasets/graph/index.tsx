'use client'

import type { GraphEntityResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SearchInput } from '@/app/components/base/search-input'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import EntityList from './entity-list'
import GraphView from './graph-view'
import StatsBar from './stats-bar'

const SUBGRAPH_LIMIT = 50

type KnowledgeGraphProps = {
  datasetId: string
}

const KnowledgeGraph = ({ datasetId }: KnowledgeGraphProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const dataset = useDatasetDetailContextWithSelector((state) => state.dataset)
  const graphEnabled = !!dataset?.graph_index_setting?.enabled

  const [searchValue, setSearchValue] = useState('')
  const [focusedEntity, setFocusedEntity] = useState<GraphEntityResponse | undefined>()

  // Clicking a node re-centres the subgraph on it, which is how you walk
  // outwards from a single entity without typing its neighbours by hand.
  const query = focusedEntity?.display_name || searchValue

  const { data: stats, isLoading: isStatsLoading } = useQuery({
    ...consoleQuery.datasets.byDatasetId.graph.stats.get.queryOptions({
      input: { params: { dataset_id: datasetId } },
    }),
    enabled: graphEnabled,
  })
  const { data: graph, isLoading: isGraphLoading } = useQuery({
    // `query` is part of the query key, so changing the focus refetches rather
    // than leaving the previous subgraph on screen.
    ...consoleQuery.datasets.byDatasetId.graph.get.queryOptions({
      input: {
        params: { dataset_id: datasetId },
        query: { ...(query ? { query } : {}), limit: SUBGRAPH_LIMIT },
      },
    }),
    enabled: graphEnabled,
  })

  const entities = useMemo(() => graph?.entities ?? [], [graph])
  const relations = useMemo(() => graph?.relations ?? [], [graph])
  const hasGraph = (stats?.entity_count ?? 0) > 0

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
      <div className="flex h-full flex-col items-center justify-center gap-y-3 px-6">
        <div className="system-md-semibold text-text-secondary">
          {t(($) => $['graph.disabledTitle'], { ns: 'datasetSettings' })}
        </div>
        <div className="max-w-125 text-center system-sm-regular text-text-tertiary">
          {t(($) => $['graph.disabledDescription'], { ns: 'datasetSettings' })}
        </div>
        <Button variant="primary" onClick={() => router.push(`/datasets/${datasetId}/settings`)}>
          {t(($) => $['graph.goToSettings'], { ns: 'datasetSettings' })}
        </Button>
      </div>
    )
  }

  if (isStatsLoading) return <Loading type="app" />

  if (!hasGraph) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-y-3 px-6">
        <div className="system-md-semibold text-text-secondary">
          {t(($) => $['graph.emptyTitle'], { ns: 'datasetSettings' })}
        </div>
        <div className="max-w-125 text-center system-sm-regular text-text-tertiary">
          {t(($) => $['graph.emptyDescription'], { ns: 'datasetSettings' })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-y-3 p-6">
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
            <Loading type="area" />
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
