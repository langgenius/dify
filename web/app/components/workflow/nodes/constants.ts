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
}
