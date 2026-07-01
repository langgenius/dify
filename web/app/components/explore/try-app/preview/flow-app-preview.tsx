'use client'
import type { TrialWorkflowGraph } from '@dify/contracts/api/console/trial-apps/types.gen'
import type { FC } from 'react'
import type { Edge, Node } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import Loading from '@/app/components/base/loading'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { useGetTryAppFlowPreview } from '@/service/use-try-app'

type Props = {
  readonly appId: string
  readonly className?: string
}

const blockTypeMap: Record<string, BlockEnum> = {
  'agent': BlockEnum.Agent,
  'agent-v2': BlockEnum.AgentV2,
  'answer': BlockEnum.Answer,
  'assigner': BlockEnum.Assigner,
  'code': BlockEnum.Code,
  'datasource': BlockEnum.DataSource,
  'datasource-empty': BlockEnum.DataSourceEmpty,
  'document-extractor': BlockEnum.DocExtractor,
  'end': BlockEnum.End,
  'http-request': BlockEnum.HttpRequest,
  'human-input': BlockEnum.HumanInput,
  'if-else': BlockEnum.IfElse,
  'iteration': BlockEnum.Iteration,
  'iteration-start': BlockEnum.IterationStart,
  'knowledge-index': BlockEnum.KnowledgeBase,
  'knowledge-retrieval': BlockEnum.KnowledgeRetrieval,
  'list-operator': BlockEnum.ListFilter,
  'llm': BlockEnum.LLM,
  'loop': BlockEnum.Loop,
  'loop-end': BlockEnum.LoopEnd,
  'loop-start': BlockEnum.LoopStart,
  'parameter-extractor': BlockEnum.ParameterExtractor,
  'question-classifier': BlockEnum.QuestionClassifier,
  'start': BlockEnum.Start,
  'start-placeholder': BlockEnum.StartPlaceholder,
  'template-transform': BlockEnum.TemplateTransform,
  'tool': BlockEnum.Tool,
  'trigger-plugin': BlockEnum.TriggerPlugin,
  'trigger-schedule': BlockEnum.TriggerSchedule,
  'trigger-webhook': BlockEnum.TriggerWebhook,
  'variable-aggregator': BlockEnum.VariableAggregator,
  'variable-assigner': BlockEnum.VariableAssigner,
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const getString = (value: unknown) => {
  return typeof value === 'string' ? value : undefined
}

const getPosition = (value: unknown) => {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number')
    return { x: 0, y: 0 }

  return {
    x: value.x,
    y: value.y,
  }
}

const getBlockType = (value: unknown) => {
  if (typeof value !== 'string')
    return null

  return blockTypeMap[value] || null
}

const normalizeWorkflowPreviewGraph = (graph: TrialWorkflowGraph) => {
  const nodes: Node[] = graph.nodes.flatMap((node) => {
    const id = getString(node.id)
    if (!id)
      return []

    const data = isRecord(node.data) ? node.data : {}
    const type = getBlockType(data.type) || BlockEnum.Start
    const title = getString(data.title) || ''

    return [{
      id,
      position: getPosition(node.position),
      ...(getString(node.type) ? { type: getString(node.type) } : {}),
      data: {
        ...data,
        desc: getString(data.desc) || '',
        title,
        type,
      },
    }]
  })
  const edges: Edge[] = graph.edges.flatMap((edge) => {
    const id = getString(edge.id)
    if (!id)
      return []

    const data = isRecord(edge.data) ? edge.data : {}
    const sourceType = getBlockType(data.sourceType) || BlockEnum.Start
    const targetType = getBlockType(data.targetType) || BlockEnum.Start

    return [{
      id,
      source: getString(edge.source) || '',
      target: getString(edge.target) || '',
      ...(getString(edge.type) ? { type: getString(edge.type) } : {}),
      ...(getString(edge.sourceHandle) ? { sourceHandle: getString(edge.sourceHandle) } : {}),
      ...(getString(edge.targetHandle) ? { targetHandle: getString(edge.targetHandle) } : {}),
      data: {
        ...data,
        sourceType,
        targetType,
      },
    }]
  })

  return {
    nodes,
    edges,
    viewport: graph.viewport,
  }
}

const FlowAppPreview: FC<Props> = ({
  appId,
  className,
}) => {
  const { data, isLoading } = useGetTryAppFlowPreview(appId)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }
  if (!data)
    return null
  const previewGraph = normalizeWorkflowPreviewGraph(data.graph)
  return (
    <div className="size-full">
      <WorkflowPreview
        {...previewGraph}
        className={cn(className)}
        miniMapToRight
      />
    </div>
  )
}
export default React.memo(FlowAppPreview)
