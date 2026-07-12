import type { ComponentProps, ComponentType } from 'react'
import { createElement } from 'react'
import { BlockEnum } from '../types'
import { AgentV2Node } from './agent-v2/node'
import { AgentV2Panel } from './agent-v2/panel'
import { isAgentV2NodeData } from './agent-v2/types'
import AgentNode from './agent/node'
import AgentPanel from './agent/panel'
import AnswerNode from './answer/node'
import AnswerPanel from './answer/panel'
import AssignerNode from './assigner/node'
import AssignerPanel from './assigner/panel'
import CodeNode from './code/node'
import CodePanel from './code/panel'
import DataSourceNode from './data-source/node'
import DataSourcePanel from './data-source/panel'
import DocExtractorNode from './document-extractor/node'
import DocExtractorPanel from './document-extractor/panel'
import EndNode from './end/node'
import EndPanel from './end/panel'
import HttpNode from './http/node'
import HttpPanel from './http/panel'
import HumanInputNode from './human-input/node'
import HumanInputPanel from './human-input/panel'
import IfElseNode from './if-else/node'
import IfElsePanel from './if-else/panel'
import IterationNode from './iteration/node'
import IterationPanel from './iteration/panel'
import KnowledgeBaseNode from './knowledge-base/node'
import KnowledgeBasePanel from './knowledge-base/panel'
import KnowledgeRetrievalNode from './knowledge-retrieval/node'
import KnowledgeRetrievalPanel from './knowledge-retrieval/panel'
import ListFilterNode from './list-operator/node'
import ListFilterPanel from './list-operator/panel'
import LLMNode from './llm/node'
import LLMPanel from './llm/panel'
import LoopNode from './loop/node'
import LoopPanel from './loop/panel'
import ParameterExtractorNode from './parameter-extractor/node'
import ParameterExtractorPanel from './parameter-extractor/panel'
import QuestionClassifierNode from './question-classifier/node'
import QuestionClassifierPanel from './question-classifier/panel'
import StartPlaceholderNode from './start-placeholder/node'
import StartPlaceholderPanel from './start-placeholder/panel'
import StartNode from './start/node'
import StartPanel from './start/panel'
import TemplateTransformNode from './template-transform/node'
import TemplateTransformPanel from './template-transform/panel'
import ToolNode from './tool/node'
import ToolPanel from './tool/panel'
import TriggerPluginNode from './trigger-plugin/node'
import TriggerPluginPanel from './trigger-plugin/panel'
import TriggerScheduleNode from './trigger-schedule/node'
import TriggerSchedulePanel from './trigger-schedule/panel'
import TriggerWebhookNode from './trigger-webhook/node'
import TriggerWebhookPanel from './trigger-webhook/panel'
import VariableAssignerNode from './variable-assigner/node'
import VariableAssignerPanel from './variable-assigner/panel'

type WorkflowAgentNodeProps = ComponentProps<typeof AgentNode> | ComponentProps<typeof AgentV2Node>
type WorkflowAgentPanelProps =
  | ComponentProps<typeof AgentPanel>
  | ComponentProps<typeof AgentV2Panel>
type WorkflowComponentMap = Record<string, ComponentType<Record<string, never>>>

function WorkflowAgentNode(props: WorkflowAgentNodeProps) {
  if (isAgentV2NodeData(props.data))
    return createElement(AgentV2Node, props as ComponentProps<typeof AgentV2Node>)

  return createElement(AgentNode, props as ComponentProps<typeof AgentNode>)
}

function WorkflowAgentPanel(props: WorkflowAgentPanelProps) {
  if (isAgentV2NodeData(props.data))
    return createElement(AgentV2Panel, props as ComponentProps<typeof AgentV2Panel>)

  return createElement(AgentPanel, props as ComponentProps<typeof AgentPanel>)
}

export const NodeComponentMap = {
  [BlockEnum.Start]: StartNode,
  [BlockEnum.StartPlaceholder]: StartPlaceholderNode,
  [BlockEnum.End]: EndNode,
  [BlockEnum.Answer]: AnswerNode,
  [BlockEnum.LLM]: LLMNode,
  [BlockEnum.KnowledgeRetrieval]: KnowledgeRetrievalNode,
  [BlockEnum.QuestionClassifier]: QuestionClassifierNode,
  [BlockEnum.IfElse]: IfElseNode,
  [BlockEnum.Code]: CodeNode,
  [BlockEnum.TemplateTransform]: TemplateTransformNode,
  [BlockEnum.HttpRequest]: HttpNode,
  [BlockEnum.Tool]: ToolNode,
  [BlockEnum.VariableAssigner]: VariableAssignerNode,
  [BlockEnum.Assigner]: AssignerNode,
  [BlockEnum.VariableAggregator]: VariableAssignerNode,
  [BlockEnum.ParameterExtractor]: ParameterExtractorNode,
  [BlockEnum.Iteration]: IterationNode,
  [BlockEnum.Loop]: LoopNode,
  [BlockEnum.DocExtractor]: DocExtractorNode,
  [BlockEnum.ListFilter]: ListFilterNode,
  [BlockEnum.Agent]: WorkflowAgentNode,
  [BlockEnum.AgentV2]: AgentV2Node,
  [BlockEnum.DataSource]: DataSourceNode,
  [BlockEnum.KnowledgeBase]: KnowledgeBaseNode,
  [BlockEnum.HumanInput]: HumanInputNode,
  [BlockEnum.TriggerSchedule]: TriggerScheduleNode,
  [BlockEnum.TriggerWebhook]: TriggerWebhookNode,
  [BlockEnum.TriggerPlugin]: TriggerPluginNode,
} as unknown as WorkflowComponentMap

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
} as unknown as WorkflowComponentMap
