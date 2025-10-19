import type { ComponentType } from 'react'
import { BlockEnum } from '../types'
import StartNode from './start/node'
import StartPanel from './start/panel'
import EndNode from './end/node'
import EndPanel from './end/panel'
import AnswerNode from './answer/node'
import AnswerPanel from './answer/panel'
import LLMNode from './llm/node'
import LLMPanel from './llm/panel'
import KnowledgeRetrievalNode from './knowledge-retrieval/node'
import KnowledgeRetrievalPanel from './knowledge-retrieval/panel'
import QuestionClassifierNode from './question-classifier/node'
import QuestionClassifierPanel from './question-classifier/panel'
import IfElseNode from './if-else/node'
import IfElsePanel from './if-else/panel'
import CodeNode from './code/node'
import CodePanel from './code/panel'
import TemplateTransformNode from './template-transform/node'
import TemplateTransformPanel from './template-transform/panel'
import HttpNode from './http/node'
import HttpPanel from './http/panel'
import ToolNode from './tool/node'
import ToolPanel from './tool/panel'
import VariableAssignerNode from './variable-assigner/node'
import VariableAssignerPanel from './variable-assigner/panel'
import AssignerNode from './assigner/node'
import AssignerPanel from './assigner/panel'
import ParameterExtractorNode from './parameter-extractor/node'
import ParameterExtractorPanel from './parameter-extractor/panel'
import IterationNode from './iteration/node'
import IterationPanel from './iteration/panel'
import LoopNode from './loop/node'
import LoopPanel from './loop/panel'
import DocExtractorNode from './document-extractor/node'
import DocExtractorPanel from './document-extractor/panel'
import ListFilterNode from './list-operator/node'
import ListFilterPanel from './list-operator/panel'
import AgentNode from './agent/node'
import AgentPanel from './agent/panel'
import DataSourceNode from './data-source/node'
import DataSourcePanel from './data-source/panel'
import KnowledgeBaseNode from './knowledge-base/node'
import KnowledgeBasePanel from './knowledge-base/panel'

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
}
