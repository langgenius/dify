import type { ComponentProps, ComponentType } from 'react'
import { createElement } from 'react'
import { BlockEnum } from '../types'
import { isAgentV2NodeData } from './agent-v2/types'
import { lazyPanel } from './lazy-panel'

const AgentV2Panel = lazyPanel(async () => {
  const { AgentV2Panel } = await import('./agent-v2/panel')
  return { default: AgentV2Panel }
})
const AgentPanel = lazyPanel(() => import('./agent/panel'))
const AnswerPanel = lazyPanel(() => import('./answer/panel'))
const AssignerPanel = lazyPanel(() => import('./assigner/panel'))
const CodePanel = lazyPanel(() => import('./code/panel'))
const DataSourcePanel = lazyPanel(() => import('./data-source/panel'))
const DocExtractorPanel = lazyPanel(() => import('./document-extractor/panel'))
const EndPanel = lazyPanel(() => import('./end/panel'))
const HttpPanel = lazyPanel(() => import('./http/panel'))
const HumanInputPanel = lazyPanel(() => import('./human-input/panel'))
const IfElsePanel = lazyPanel(() => import('./if-else/panel'))
const IterationPanel = lazyPanel(() => import('./iteration/panel'))
const KnowledgeBasePanel = lazyPanel(() => import('./knowledge-base/panel'))
const KnowledgeRetrievalPanel = lazyPanel(() => import('./knowledge-retrieval/panel'))
const ListFilterPanel = lazyPanel(() => import('./list-operator/panel'))
const LLMPanel = lazyPanel(() => import('./llm/panel'))
const LoopPanel = lazyPanel(() => import('./loop/panel'))
const ParameterExtractorPanel = lazyPanel(() => import('./parameter-extractor/panel'))
const QuestionClassifierPanel = lazyPanel(() => import('./question-classifier/panel'))
const StartPlaceholderPanel = lazyPanel(() => import('./start-placeholder/panel'))
const StartPanel = lazyPanel(() => import('./start/panel'))
const TemplateTransformPanel = lazyPanel(() => import('./template-transform/panel'))
const ToolPanel = lazyPanel(() => import('./tool/panel'))
const TriggerPluginPanel = lazyPanel(() => import('./trigger-plugin/panel'))
const TriggerSchedulePanel = lazyPanel(() => import('./trigger-schedule/panel'))
const TriggerWebhookPanel = lazyPanel(() => import('./trigger-webhook/panel'))
const VariableAssignerPanel = lazyPanel(() => import('./variable-assigner/panel'))

function WorkflowAgentPanel(
  props: ComponentProps<typeof AgentPanel> | ComponentProps<typeof AgentV2Panel>,
) {
  if (isAgentV2NodeData(props.data))
    return createElement(AgentV2Panel, props as ComponentProps<typeof AgentV2Panel>)

  return createElement(AgentPanel, props as ComponentProps<typeof AgentPanel>)
}

export const PanelComponentMap = {
  [BlockEnum.Start]: StartPanel,
  [BlockEnum.StartPlaceholder]: StartPlaceholderPanel,
  [BlockEnum.End]: EndPanel,
  [BlockEnum.Answer]: AnswerPanel,
  [BlockEnum.LLM]: LLMPanel,
  [BlockEnum.KnowledgeRetrieval]: KnowledgeRetrievalPanel,
  [BlockEnum.QuestionClassifier]: QuestionClassifierPanel,
  [BlockEnum.IfElse]: IfElsePanel,
  [BlockEnum.Code]: CodePanel,
  [BlockEnum.TemplateTransform]: TemplateTransformPanel,
  [BlockEnum.HttpRequest]: HttpPanel,
  [BlockEnum.Tool]: ToolPanel,
  [BlockEnum.VariableAssigner]: VariableAssignerPanel,
  [BlockEnum.VariableAggregator]: VariableAssignerPanel,
  [BlockEnum.Assigner]: AssignerPanel,
  [BlockEnum.ParameterExtractor]: ParameterExtractorPanel,
  [BlockEnum.Iteration]: IterationPanel,
  [BlockEnum.Loop]: LoopPanel,
  [BlockEnum.DocExtractor]: DocExtractorPanel,
  [BlockEnum.ListFilter]: ListFilterPanel,
  [BlockEnum.Agent]: WorkflowAgentPanel,
  [BlockEnum.AgentV2]: AgentV2Panel,
  [BlockEnum.DataSource]: DataSourcePanel,
  [BlockEnum.KnowledgeBase]: KnowledgeBasePanel,
  [BlockEnum.HumanInput]: HumanInputPanel,
  [BlockEnum.TriggerSchedule]: TriggerSchedulePanel,
  [BlockEnum.TriggerWebhook]: TriggerWebhookPanel,
  [BlockEnum.TriggerPlugin]: TriggerPluginPanel,
} as unknown as Record<string, ComponentType<Record<string, never>>>
