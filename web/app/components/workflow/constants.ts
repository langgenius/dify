import type { Var } from './types'
import { BlockEnum, VarType } from './types'
import StartNodeDefault from './nodes/start/default'
import AnswerDefault from './nodes/answer/default'
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

export const NODES_EXTRA_DATA = {
  [BlockEnum.Start]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.End]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.Answer]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.LLM]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.KnowledgeRetrieval]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.IfElse]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.Code]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.TemplateTransform]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.QuestionClassifier]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.HttpRequest]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.VariableAssigner]: {
    author: 'Dify',
    about: '',
  },
  [BlockEnum.Tool]: {
    author: 'Dify',
    about: '',
  },
}

export const ALL_CHAT_AVAILABLE_BLOCKS = Object.keys(NODES_EXTRA_DATA).filter(key => key !== BlockEnum.End) as BlockEnum[]
export const ALL_COMPLETION_AVAILABLE_BLOCKS = Object.keys(NODES_EXTRA_DATA).filter(key => key !== BlockEnum.Answer) as BlockEnum[]

export const NODES_INITIAL_DATA = {
  [BlockEnum.Start]: {
    type: BlockEnum.Start,
    title: '',
    desc: '',
    ...StartNodeDefault.defaultValue,
  },
  [BlockEnum.End]: {
    type: BlockEnum.End,
    title: '',
    desc: '',
    ...EndNodeDefault.defaultValue,
  },
  [BlockEnum.Answer]: {
    type: BlockEnum.Answer,
    title: '',
    desc: '',
    ...AnswerDefault.defaultValue,
  },
  [BlockEnum.LLM]: {
    type: BlockEnum.LLM,
    title: '',
    desc: '',
    variables: [],
    ...LLMDefault.defaultValue,
  },
  [BlockEnum.KnowledgeRetrieval]: {
    type: BlockEnum.KnowledgeRetrieval,
    title: '',
    desc: '',
    query_variable_selector: [],
    dataset_ids: [],
    retrieval_mode: 'single',
    ...KnowledgeRetrievalDefault.defaultValue,
  },
  [BlockEnum.IfElse]: {
    type: BlockEnum.IfElse,
    title: '',
    desc: '',
    ...IfElseDefault.defaultValue,
  },
  [BlockEnum.Code]: {
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
    type: BlockEnum.TemplateTransform,
    title: '',
    desc: '',
    variables: [],
    template: '',
    ...TemplateTransformDefault.defaultValue,
  },
  [BlockEnum.QuestionClassifier]: {
    type: BlockEnum.QuestionClassifier,
    title: '',
    desc: '',
    query_variable_selector: [],
    topics: [],
    ...QuestionClassifierDefault.defaultValue,
  },
  [BlockEnum.HttpRequest]: {
    type: BlockEnum.HttpRequest,
    title: '',
    desc: '',
    variables: [],
    ...HttpRequestDefault.defaultValue,
  },
  [BlockEnum.VariableAssigner]: {
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
export const NODE_WIDTH_X_OFFSET = NODE_WIDTH + X_OFFSET
export const Y_OFFSET = 39
export const TREE_DEEPTH = 20
export const START_INITIAL_POSITION = { x: 80, y: 282 }

export const RETRIEVAL_OUTPUT_STRUCT = `{
  "content": "",
  "title": "",
  "url": "",
  "icon": "",
  "metadata": {
    "dataset_id": "",
    "dataset_name": "",
    "document_id": [],
    "document_name": "",
    "document_data_source_type": "",
    "segment_id": "",
    "segment_position": "",
    "segment_word_count": "",
    "segment_hit_count": "",
    "segment_index_node_hash": "",
    "score": ""
  }
}`

export const SUPPORT_OUTPUT_VARS_NODE = [
  BlockEnum.Start, BlockEnum.LLM, BlockEnum.KnowledgeRetrieval, BlockEnum.Code, BlockEnum.TemplateTransform,
  BlockEnum.QuestionClassifier, BlockEnum.HttpRequest, BlockEnum.Tool, BlockEnum.VariableAssigner,
]

const USAGE = {
  variable: 'usage',
  type: VarType.object,
  children: [
    {
      variable: 'prompt_tokens',
      type: VarType.number,
    },
    {
      variable: 'prompt_unit_price',
      type: VarType.number,
    },
    {
      variable: 'prompt_price_unit',
      type: VarType.number,
    },
    {
      variable: 'prompt_price',
      type: VarType.number,
    },
    {
      variable: 'completion_tokens',
      type: VarType.number,
    },
    {
      variable: 'completion_unit_price',
      type: VarType.number,
    },
    {
      variable: 'completion_price_unit',
      type: VarType.number,
    },
    {
      variable: 'completion_unit_price',
      type: VarType.number,
    },
    {
      variable: 'completion_price',
      type: VarType.number,
    },
    {
      variable: 'total_tokens',
      type: VarType.number,
    },
    {
      variable: 'total_price',
      type: VarType.number,
    },
    {
      variable: 'currency',
      type: VarType.string,
    },
    {
      variable: 'latency',
      type: VarType.number,
    },
  ],
}
export const LLM_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'text',
    type: VarType.string,
  },
  USAGE,
]

export const KNOWLEDGE_RETRIEVAL_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'result',
    type: VarType.arrayObject,
  },
  USAGE,
]

export const TEMPLATE_TRANSFORM_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'output',
    type: VarType.string,
  },
]

const QUESTION_CLASSIFIER_OUTPUT_STRUCT_COMMON: Var[] = [
  USAGE,
  {
    variable: 'topic',
    type: VarType.string,
  },
]

export const CHAT_QUESTION_CLASSIFIER_OUTPUT_STRUCT = [
  {
    variable: 'model_mode',
    type: VarType.string,
  },
  {
    variable: 'messages',
    type: VarType.arrayObject,
  },
  ...QUESTION_CLASSIFIER_OUTPUT_STRUCT_COMMON,
]

export const COMPLETION_QUESTION_CLASSIFIER_OUTPUT_STRUCT = [
  {
    variable: 'model_mode',
    type: VarType.string,
  },
  {
    variable: 'text',
    type: VarType.string,
  },
  ...QUESTION_CLASSIFIER_OUTPUT_STRUCT_COMMON,
]

export const HTTP_REQUEST_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'body',
    type: VarType.string,
  },
  {
    variable: 'status_code',
    type: VarType.string,
  },
  {
    variable: 'headers',
    type: VarType.string,
  },
]

export const TOOL_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'text',
    type: VarType.string,
  },
  {
    variable: 'files',
    type: VarType.arrayFile,
  },
]
