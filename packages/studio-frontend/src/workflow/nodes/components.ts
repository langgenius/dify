import type { ComponentType } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import AgentNode from '@/app/components/workflow/nodes/agent/node'
import AgentPanel from '@/app/components/workflow/nodes/agent/panel'
import AnswerNode from '@/app/components/workflow/nodes/answer/node'
import AnswerPanel from '@/app/components/workflow/nodes/answer/panel'
import AssignerNode from '@/app/components/workflow/nodes/assigner/node'
import AssignerPanel from '@/app/components/workflow/nodes/assigner/panel'
import CodeNode from '@/app/components/workflow/nodes/code/node'
import CodePanel from '@/app/components/workflow/nodes/code/panel'
import DataSourceNode from '@/app/components/workflow/nodes/data-source/node'
import DataSourcePanel from '@/app/components/workflow/nodes/data-source/panel'
import DocExtractorNode from '@/app/components/workflow/nodes/document-extractor/node'
import DocExtractorPanel from '@/app/components/workflow/nodes/document-extractor/panel'
import EndNode from '@/app/components/workflow/nodes/end/node'
import EndPanel from '@/app/components/workflow/nodes/end/panel'
import HttpNode from '@/app/components/workflow/nodes/http/node'
import HttpPanel from '@/app/components/workflow/nodes/http/panel'
import HumanInputNode from '@/app/components/workflow/nodes/human-input/node'
import HumanInputPanel from '@/app/components/workflow/nodes/human-input/panel'
import IfElseNode from '@/app/components/workflow/nodes/if-else/node'
import IfElsePanel from '@/app/components/workflow/nodes/if-else/panel'
import IterationNode from '@/app/components/workflow/nodes/iteration/node'
import IterationPanel from '@/app/components/workflow/nodes/iteration/panel'
import KnowledgeBaseNode from '@/app/components/workflow/nodes/knowledge-base/node'
import KnowledgeBasePanel from '@/app/components/workflow/nodes/knowledge-base/panel'
import KnowledgeRetrievalNode from '@/app/components/workflow/nodes/knowledge-retrieval/node'
import KnowledgeRetrievalPanel from '@/app/components/workflow/nodes/knowledge-retrieval/panel'
import ListFilterNode from '@/app/components/workflow/nodes/list-operator/node'
import ListFilterPanel from '@/app/components/workflow/nodes/list-operator/panel'
import LLMNode from '@/app/components/workflow/nodes/llm/node'
import LLMPanel from '@/app/components/workflow/nodes/llm/panel'
import LoopNode from '@/app/components/workflow/nodes/loop/node'
import LoopPanel from '@/app/components/workflow/nodes/loop/panel'
import ParameterExtractorNode from '@/app/components/workflow/nodes/parameter-extractor/node'
import ParameterExtractorPanel from '@/app/components/workflow/nodes/parameter-extractor/panel'
import QuestionClassifierNode from '@/app/components/workflow/nodes/question-classifier/node'
import QuestionClassifierPanel from '@/app/components/workflow/nodes/question-classifier/panel'
import StartNode from '@/app/components/workflow/nodes/start/node'
import StartPanel from '@/app/components/workflow/nodes/start/panel'
import TemplateTransformNode from '@/app/components/workflow/nodes/template-transform/node'
import TemplateTransformPanel from '@/app/components/workflow/nodes/template-transform/panel'
import ToolNode from '@/app/components/workflow/nodes/tool/node'
import ToolPanel from '@/app/components/workflow/nodes/tool/panel'
import TriggerPluginNode from '@/app/components/workflow/nodes/trigger-plugin/node'
import TriggerPluginPanel from '@/app/components/workflow/nodes/trigger-plugin/panel'
import TriggerScheduleNode from '@/app/components/workflow/nodes/trigger-schedule/node'
import TriggerSchedulePanel from '@/app/components/workflow/nodes/trigger-schedule/panel'
import TriggerWebhookNode from '@/app/components/workflow/nodes/trigger-webhook/node'
import TriggerWebhookPanel from '@/app/components/workflow/nodes/trigger-webhook/panel'
import VariableAssignerNode from '@/app/components/workflow/nodes/variable-assigner/node'
import VariableAssignerPanel from '@/app/components/workflow/nodes/variable-assigner/panel'

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
