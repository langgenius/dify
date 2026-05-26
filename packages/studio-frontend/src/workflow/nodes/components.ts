import type { ComponentType } from 'react'
import { BlockEnum } from '../types'
import AgentNode from '../nodes/agent/node'
import AgentPanel from '../nodes/agent/panel'
import AnswerNode from '../nodes/answer/node'
import AnswerPanel from '../nodes/answer/panel'
import AssignerNode from '../nodes/assigner/node'
import AssignerPanel from '../nodes/assigner/panel'
import CodeNode from '../nodes/code/node'
import CodePanel from '../nodes/code/panel'
import DataSourceNode from '../nodes/data-source/node'
import DataSourcePanel from '../nodes/data-source/panel'
import DocExtractorNode from '../nodes/document-extractor/node'
import DocExtractorPanel from '../nodes/document-extractor/panel'
import EndNode from '../nodes/end/node'
import EndPanel from '../nodes/end/panel'
import HttpNode from '../nodes/http/node'
import HttpPanel from '../nodes/http/panel'
import HumanInputNode from '../nodes/human-input/node'
import HumanInputPanel from '../nodes/human-input/panel'
import IfElseNode from '../nodes/if-else/node'
import IfElsePanel from '../nodes/if-else/panel'
import IterationNode from '../nodes/iteration/node'
import IterationPanel from '../nodes/iteration/panel'
import KnowledgeBaseNode from '../nodes/knowledge-base/node'
import KnowledgeBasePanel from '../nodes/knowledge-base/panel'
import KnowledgeRetrievalNode from '../nodes/knowledge-retrieval/node'
import KnowledgeRetrievalPanel from '../nodes/knowledge-retrieval/panel'
import ListFilterNode from '../nodes/list-operator/node'
import ListFilterPanel from '../nodes/list-operator/panel'
import LLMNode from '../nodes/llm/node'
import LLMPanel from '../nodes/llm/panel'
import LoopNode from '../nodes/loop/node'
import LoopPanel from '../nodes/loop/panel'
import ParameterExtractorNode from '../nodes/parameter-extractor/node'
import ParameterExtractorPanel from '../nodes/parameter-extractor/panel'
import QuestionClassifierNode from '../nodes/question-classifier/node'
import QuestionClassifierPanel from '../nodes/question-classifier/panel'
import StartNode from '../nodes/start/node'
import StartPanel from '../nodes/start/panel'
import TemplateTransformNode from '../nodes/template-transform/node'
import TemplateTransformPanel from '../nodes/template-transform/panel'
import ToolNode from '../nodes/tool/node'
import ToolPanel from '../nodes/tool/panel'
import TriggerPluginNode from '../nodes/trigger-plugin/node'
import TriggerPluginPanel from '../nodes/trigger-plugin/panel'
import TriggerScheduleNode from '../nodes/trigger-schedule/node'
import TriggerSchedulePanel from '../nodes/trigger-schedule/panel'
import TriggerWebhookNode from '../nodes/trigger-webhook/node'
import TriggerWebhookPanel from '../nodes/trigger-webhook/panel'
import VariableAssignerNode from '../nodes/variable-assigner/node'
import VariableAssignerPanel from '../nodes/variable-assigner/panel'

export const NodeComponentMap: Record<string, ComponentType<any>> = {
  [BlockEnum.Start]: StartNode,
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
  [BlockEnum.Agent]: AgentNode,
  [BlockEnum.DataSource]: DataSourceNode,
  [BlockEnum.KnowledgeBase]: KnowledgeBaseNode,
  [BlockEnum.HumanInput]: HumanInputNode,
  [BlockEnum.TriggerSchedule]: TriggerScheduleNode,
  [BlockEnum.TriggerWebhook]: TriggerWebhookNode,
  [BlockEnum.TriggerPlugin]: TriggerPluginNode,
}

export const PanelComponentMap: Record<string, ComponentType<any>> = {
  [BlockEnum.Start]: StartPanel,
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
  [BlockEnum.Agent]: AgentPanel,
  [BlockEnum.DataSource]: DataSourcePanel,
  [BlockEnum.KnowledgeBase]: KnowledgeBasePanel,
  [BlockEnum.HumanInput]: HumanInputPanel,
  [BlockEnum.TriggerSchedule]: TriggerSchedulePanel,
  [BlockEnum.TriggerWebhook]: TriggerWebhookPanel,
  [BlockEnum.TriggerPlugin]: TriggerPluginPanel,
}
