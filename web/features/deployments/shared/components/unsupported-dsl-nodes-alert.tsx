'use client'

import type { SelectorParam, TFunction } from 'i18next'
import type { UnsupportedDslNode } from '../domain/error'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { BlockEnum } from '@/app/components/workflow/types'

const workflowBlockTypeSelectors: Record<BlockEnum, SelectorParam<'workflow'>> = {
  [BlockEnum.Start]: $ => $['blocks.start'],
  [BlockEnum.StartPlaceholder]: $ => $['blocks.start-placeholder'],
  [BlockEnum.End]: $ => $['blocks.end'],
  [BlockEnum.Answer]: $ => $['blocks.answer'],
  [BlockEnum.LLM]: $ => $['blocks.llm'],
  [BlockEnum.KnowledgeRetrieval]: $ => $['blocks.knowledge-retrieval'],
  [BlockEnum.QuestionClassifier]: $ => $['blocks.question-classifier'],
  [BlockEnum.IfElse]: $ => $['blocks.if-else'],
  [BlockEnum.Code]: $ => $['blocks.code'],
  [BlockEnum.TemplateTransform]: $ => $['blocks.template-transform'],
  [BlockEnum.HttpRequest]: $ => $['blocks.http-request'],
  [BlockEnum.VariableAssigner]: $ => $['blocks.variable-assigner'],
  [BlockEnum.VariableAggregator]: $ => $['blocks.variable-aggregator'],
  [BlockEnum.Tool]: $ => $['blocks.tool'],
  [BlockEnum.ParameterExtractor]: $ => $['blocks.parameter-extractor'],
  [BlockEnum.Iteration]: $ => $['blocks.iteration'],
  [BlockEnum.DocExtractor]: $ => $['blocks.document-extractor'],
  [BlockEnum.ListFilter]: $ => $['blocks.list-operator'],
  [BlockEnum.IterationStart]: $ => $['blocks.iteration-start'],
  [BlockEnum.Assigner]: $ => $['blocks.assigner'],
  [BlockEnum.Agent]: $ => $['blocks.agent'],
  [BlockEnum.AgentV2]: $ => $['blocks.agent-v2'],
  [BlockEnum.Loop]: $ => $['blocks.loop'],
  [BlockEnum.LoopStart]: $ => $['blocks.loop-start'],
  [BlockEnum.LoopEnd]: $ => $['blocks.loop-end'],
  [BlockEnum.HumanInput]: $ => $['blocks.human-input'],
  [BlockEnum.DataSource]: $ => $['blocks.datasource'],
  [BlockEnum.DataSourceEmpty]: $ => $['blocks.datasource-empty'],
  [BlockEnum.KnowledgeBase]: $ => $['blocks.knowledge-index'],
  [BlockEnum.TriggerSchedule]: $ => $['blocks.trigger-schedule'],
  [BlockEnum.TriggerWebhook]: $ => $['blocks.trigger-webhook'],
  [BlockEnum.TriggerPlugin]: $ => $['blocks.trigger-plugin'],
}

function isWorkflowBlockType(type: string): type is BlockEnum {
  return Object.hasOwn(workflowBlockTypeSelectors, type)
}

function translatedNodeType(
  type: string | undefined,
  tDeployments: TFunction<'deployments'>,
  tWorkflow: TFunction<'workflow'>,
) {
  if (!type)
    return tDeployments($ => $['unsupportedDslNodes.unknownType'])

  if (!isWorkflowBlockType(type))
    return type

  return tWorkflow(workflowBlockTypeSelectors[type])
}

function unsupportedNodeTypeLabels(
  nodes: UnsupportedDslNode[],
  tDeployments: TFunction<'deployments'>,
  tWorkflow: TFunction<'workflow'>,
) {
  return Array.from(new Set(nodes.map(node => translatedNodeType(node.type, tDeployments, tWorkflow))))
}

function formattedNodeTypeList(labels: string[], language: string) {
  if (labels.length === 0)
    return ''

  try {
    return new Intl.ListFormat(language, { type: 'conjunction' }).format(labels)
  }
  catch {
    return labels.join(', ')
  }
}

export function UnsupportedDslNodesAlert({ nodes, className }: {
  nodes: UnsupportedDslNode[]
  className?: string
}) {
  const { i18n, t } = useTranslation('deployments')
  const { t: tWorkflow } = useTranslation('workflow')

  if (nodes.length === 0)
    return null

  const nodeTypeLabels = unsupportedNodeTypeLabels(nodes, t, tWorkflow)
  const nodeTypes = formattedNodeTypeList(nodeTypeLabels, i18n.language)
  const description = nodeTypes
    ? t($ => $['unsupportedDslNodes.descriptionWithTypes'], { nodeTypes })
    : t($ => $['unsupportedDslNodes.description'])

  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-util-colors-red-red-200 bg-util-colors-red-red-50 p-3',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0 text-text-destructive" />
        <div className="min-w-0 grow">
          <div className="system-sm-semibold text-text-primary">
            {t($ => $['unsupportedDslNodes.title'])}
          </div>
          <p className="mt-0.5 system-xs-regular text-text-secondary">
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}
