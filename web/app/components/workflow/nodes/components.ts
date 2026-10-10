import type { ComponentProps, ComponentType } from 'react'
import { createElement } from 'react'
import { BlockEnum } from '../types'
import { AgentV2Node } from './agent-v2/node'
import { isAgentV2NodeData } from './agent-v2/types'
import AgentNode from './agent/node'
import AnswerNode from './answer/node'
import AssignerNode from './assigner/node'
import CodeNode from './code/node'
import DataSourceNode from './data-source/node'
import DocExtractorNode from './document-extractor/node'
import EndNode from './end/node'
import HttpNode from './http/node'
import HumanInputNode from './human-input/node'
import IfElseNode from './if-else/node'
import IterationNode from './iteration/node'
import KnowledgeBaseNode from './knowledge-base/node'
import KnowledgeRetrievalNode from './knowledge-retrieval/node'
import ListFilterNode from './list-operator/node'
import LLMNode from './llm/node'
import LoopNode from './loop/node'
import ParameterExtractorNode from './parameter-extractor/node'
import QuestionClassifierNode from './question-classifier/node'
import StartPlaceholderNode from './start-placeholder/node'
import StartNode from './start/node'
import TemplateTransformNode from './template-transform/node'
import ToolNode from './tool/node'
import TriggerPluginNode from './trigger-plugin/node'
import TriggerScheduleNode from './trigger-schedule/node'
import TriggerWebhookNode from './trigger-webhook/node'
import VariableAssignerNode from './variable-assigner/node'

type WorkflowAgentNodeProps = ComponentProps<typeof AgentNode> | ComponentProps<typeof AgentV2Node>
type WorkflowComponentMap = Record<string, ComponentType<Record<string, never>>>

function WorkflowAgentNode(props: WorkflowAgentNodeProps) {
  if (isAgentV2NodeData(props.data))
    return createElement(AgentV2Node, props as ComponentProps<typeof AgentV2Node>)

  return createElement(AgentNode, props as ComponentProps<typeof AgentNode>)
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
