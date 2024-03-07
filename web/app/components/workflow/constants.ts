import { BlockEnum } from './types'
import StartNodeDefault from './nodes/start/default'
import DirectAnswerDefault from './nodes/direct-answer/default'
import LLMDefault from './nodes/llm/default'
import KnowledgeRetrievalDefault from './nodes/knowledge-retrieval/default'
import QuestionClassifierDefault from './nodes/question-classifier/default'
import IfElseDefault from './nodes/if-else/default'
import CodeDefault from './nodes/code/default'
import TemplateTransformDefault from './nodes/template-transform/default'
import HttpRequestDefault from './nodes/http/default'
import ToolDefault from './nodes/tool/default'
import VariableAssignerDefault from './nodes/variable-assigner/default'
import EndNodeDefault from './nodes/end/default'

export const NODES_INITIAL_DATA = {
  [BlockEnum.Start]: {
    _author: 'Dify',
    type: BlockEnum.Start,
    title: '',
    desc: '',
    ...StartNodeDefault.defaultValue,
  },
  [BlockEnum.End]: {
    _author: 'Dify',
    type: BlockEnum.End,
    title: '',
    desc: '',
    ...EndNodeDefault.defaultValue,
  },
  [BlockEnum.DirectAnswer]: {
    _author: 'Dify',
    type: BlockEnum.DirectAnswer,
    title: '',
    desc: '',
    ...DirectAnswerDefault.defaultValue,
  },
  [BlockEnum.LLM]: {
    _author: 'Dify',
    type: BlockEnum.LLM,
    title: '',
    desc: '',
    variables: [],
    ...LLMDefault.defaultValue,
  },
  [BlockEnum.KnowledgeRetrieval]: {
    _author: 'Dify',
    type: BlockEnum.KnowledgeRetrieval,
    title: '',
    desc: '',
    query_variable_selector: [],
    dataset_ids: [],
    retrieval_mode: 'single',
    ...KnowledgeRetrievalDefault.defaultValue,
  },
  [BlockEnum.IfElse]: {
    _author: 'Dify',
    type: BlockEnum.IfElse,
    title: '',
    desc: '',
    ...IfElseDefault.defaultValue,
  },
  [BlockEnum.Code]: {
    _author: 'Dify',
    type: BlockEnum.Code,
    title: '',
    desc: '',
    variables: [],
    code_language: 'python3',
    code: '',
    outputs: [],
    ...CodeDefault.defaultValue,
  },
  [BlockEnum.TemplateTransform]: {
    _author: 'Dify',
    type: BlockEnum.TemplateTransform,
    title: '',
    desc: '',
    variables: [],
    template: '',
    ...TemplateTransformDefault.defaultValue,
  },
  [BlockEnum.QuestionClassifier]: {
    _author: 'Dify',
    type: BlockEnum.QuestionClassifier,
    title: '',
    desc: '',
    query_variable_selector: [],
    topics: [],
    ...QuestionClassifierDefault.defaultValue,
  },
  [BlockEnum.HttpRequest]: {
    _author: 'Dify',
    type: BlockEnum.HttpRequest,
    title: '',
    desc: '',
    variables: [],
    ...HttpRequestDefault.defaultValue,
  },
  [BlockEnum.VariableAssigner]: {
    _author: 'Dify',
    type: BlockEnum.VariableAssigner,
    title: '',
    desc: '',
    variables: [],
    output_type: '',
    ...VariableAssignerDefault.defaultValue,
  },
  [BlockEnum.Tool]: {
    type: BlockEnum.Tool,
    title: '',
    desc: '',
    ...ToolDefault.defaultValue,
  },
}

export const NODE_WIDTH = 220
export const X_OFFSET = 64
export const Y_OFFSET = 39
export const TREE_DEEPTH = 20
