'use client'

import type {
  GraphEntityResponse,
  GraphRelationResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
// Types only — erased at build time, so pulling these from the full package
// costs nothing at runtime (the modular submodules below don't re-export them).
import type { GraphSeriesOption, TooltipComponentOption } from 'echarts'
import type { ComposeOption } from 'echarts/core'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useTheme from '@/hooks/use-theme'
import { getGraphChartColors, getNodeSize } from './graph-colors'

// The full `echarts` package bundles every chart type and component, which is
// dramatically more expensive to build than this view needs — pulling it in
// (as `echarts-for-react`'s default export does) took Turbopack ~10 minutes to
// compile on first hit. Registering only the graph series, tooltip, and canvas
// renderer keeps the bundle to what this view actually uses.
echarts.use([GraphChart, TooltipComponent, CanvasRenderer])

type EChartsOption = ComposeOption<GraphSeriesOption | TooltipComponentOption>

type GraphViewProps = {
  entities: GraphEntityResponse[]
  relations: GraphRelationResponse[]
  focusedEntityName?: string
  onEntityClick?: (entity: GraphEntityResponse) => void
}

/** Extra fields carried on each datum so the tooltip needs no entity lookup. */
type NodeDatum = {
  id: string
  entityType: string
  description: string
  frequency: number
}

type LinkDatum = {
  value: string
  description: string
}

type EChartsCallbackParams = {
  dataType?: 'node' | 'edge'
  name: string
  data: NodeDatum & LinkDatum
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const GraphView = ({ entities, relations, focusedEntityName, onEntityClick }: GraphViewProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const colors = getGraphChartColors(theme)

  const option = useMemo(() => {
    const maxFrequency = entities.reduce((max, entity) => Math.max(max, entity.frequency), 1)
    const entityIds = new Set(entities.map((entity) => entity.id))

    const nodes = entities.map((entity) => {
      const isFocused = !!focusedEntityName && entity.name === focusedEntityName
      return {
        id: entity.id,
        name: entity.display_name,
        symbolSize: getNodeSize(entity.frequency, maxFrequency),
        itemStyle: {
          color: isFocused ? colors.focusedNode : colors.node,
          // A 2px surface ring keeps overlapping nodes readable.
          borderColor: colors.surface,
          borderWidth: 2,
        },
        label: {
          show: true,
          color: colors.label,
          fontSize: 12,
          position: 'right' as const,
        },
        entityType: entity.entity_type,
        description: entity.description,
        frequency: entity.frequency,
      }
    })

    // Drop edges whose endpoints fall outside the returned subgraph, otherwise
    // ECharts invents placeholder nodes for them.
    const links = relations
      .filter(
        (relation) =>
          entityIds.has(relation.source_entity_id) && entityIds.has(relation.target_entity_id),
      )
      .map((relation) => ({
        source: relation.source_entity_id,
        target: relation.target_entity_id,
        value: relation.predicate,
        lineStyle: {
          color: colors.edge,
          width: 1.5,
          curveness: 0.1,
          opacity: 0.9,
        },
        label: {
          show: false,
          formatter: relation.predicate,
          fontSize: 10,
          color: colors.mutedLabel,
        },
        emphasis: {
          label: { show: true },
          lineStyle: { width: 2.5, color: colors.focusedNode },
        },
        description: relation.description,
      }))

    const describe = (description: string) =>
      description
        ? `<div style="margin-top:4px;color:${colors.mutedLabel};font-size:12px;max-width:280px;white-space:normal">${escapeHtml(description)}</div>`
        : ''

    const chartOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: EChartsCallbackParams) => {
          if (params.dataType === 'edge') {
            return `<div style="font-size:13px;color:${colors.label}">${escapeHtml(params.data.value)}</div>${describe(params.data.description)}`
          }
          const mentions = t(($) => $['graph.mentionCount'], {
            ns: 'datasetSettings',
            count: params.data.frequency,
          })
          return [
            `<div style="font-size:13px;font-weight:600;color:${colors.label}">${escapeHtml(params.name)}</div>`,
            `<div style="margin-top:2px;color:${colors.mutedLabel};font-size:12px">${escapeHtml(params.data.entityType)} · ${escapeHtml(mentions)}</div>`,
            describe(params.data.description),
          ].join('')
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          data: nodes,
          links,
          force: {
            repulsion: 260,
            edgeLength: [80, 200],
            gravity: 0.08,
            friction: 0.2,
          },
          emphasis: {
            focus: 'adjacency',
            scale: 1.1,
          },
          labelLayout: { hideOverlap: true },
          lineStyle: { color: colors.edge },
        },
      ],
    }

    // ECharts' option type rejects the extra per-datum fields the tooltip reads,
    // so the assertion is confined to this one boundary.
    return chartOption as unknown as EChartsOption
  }, [entities, relations, focusedEntityName, colors, t])

  const handleEvents = useMemo(
    () => ({
      click: (params: EChartsCallbackParams) => {
        if (params.dataType !== 'node') return
        const entity = entities.find((item) => item.id === params.data.id)
        if (entity) onEntityClick?.(entity)
      },
    }),
    [entities, onEntityClick],
  )

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ width: '100%', height: '100%' }}
      opts={{ renderer: 'canvas' }}
      // ECharts merges options by default, which would leave stale nodes on
      // screen when the focused subgraph shrinks.
      notMerge
      lazyUpdate
      onEvents={handleEvents}
    />
  )
}

export default memo(GraphView)
