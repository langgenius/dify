import type { ComponentType } from 'react'
import StartNode from './start/node'
import StartPanel from './start/panel'
import EndNode from './end/node'
import EndPanel from './end/panel'
import DirectAnswerNode from './direct-answer/node'
import DirectAnswerPanel from './direct-answer/panel'
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

export const NodeMap: Record<string, ComponentType> = {
  start: StartNode,
  end: EndNode,
  directAnswer: DirectAnswerNode,
  llm: LLMNode,
  knowledgeRetrieval: KnowledgeRetrievalNode,
  questionClassifier: QuestionClassifierNode,
  ifElse: IfElseNode,
  code: CodeNode,
  templateTransform: TemplateTransformNode,
  http: HttpNode,
  tool: ToolNode,
}

export const PanelMap: Record<string, ComponentType> = {
  start: StartPanel,
  end: EndPanel,
  directAnswer: DirectAnswerPanel,
  llm: LLMPanel,
  knowledgeRetrieval: KnowledgeRetrievalPanel,
  questionClassifier: QuestionClassifierPanel,
  ifElse: IfElsePanel,
  code: CodePanel,
  templateTransform: TemplateTransformPanel,
  http: HttpPanel,
  tool: ToolPanel,
}
