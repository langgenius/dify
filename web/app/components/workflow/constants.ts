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
import ParameterExtractorDefault from './nodes/parameter-extractor/default'
import ToolDefault from './nodes/tool/default'
import VariableAssignerDefault from './nodes/variable-assigner/default'
import EndNodeDefault from './nodes/end/default'
import IterationDefault from './nodes/iteration/default'

type NodesExtraData = {
  author: string
  about: string
  availablePrevNodes: BlockEnum[]
  availableNextNodes: BlockEnum[]
  getAvailablePrevNodes: (isChatMode: boolean) => BlockEnum[]
  getAvailableNextNodes: (isChatMode: boolean) => BlockEnum[]
  checkValid: any
}
export const NODES_EXTRA_DATA: Record<BlockEnum, NodesExtraData> = {
  [BlockEnum.Start]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: StartNodeDefault.getAvailablePrevNodes,
    getAvailableNextNodes: StartNodeDefault.getAvailableNextNodes,
    checkValid: StartNodeDefault.checkValid,
  },
  [BlockEnum.End]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: EndNodeDefault.getAvailablePrevNodes,
    getAvailableNextNodes: EndNodeDefault.getAvailableNextNodes,
    checkValid: EndNodeDefault.checkValid,
  },
  [BlockEnum.Answer]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: AnswerDefault.getAvailablePrevNodes,
    getAvailableNextNodes: AnswerDefault.getAvailableNextNodes,
    checkValid: AnswerDefault.checkValid,
  },
  [BlockEnum.LLM]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: LLMDefault.getAvailablePrevNodes,
    getAvailableNextNodes: LLMDefault.getAvailableNextNodes,
    checkValid: LLMDefault.checkValid,
  },
  [BlockEnum.KnowledgeRetrieval]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: KnowledgeRetrievalDefault.getAvailablePrevNodes,
    getAvailableNextNodes: KnowledgeRetrievalDefault.getAvailableNextNodes,
    checkValid: KnowledgeRetrievalDefault.checkValid,
  },
  [BlockEnum.IfElse]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: IfElseDefault.getAvailablePrevNodes,
    getAvailableNextNodes: IfElseDefault.getAvailableNextNodes,
    checkValid: IfElseDefault.checkValid,
  },
  [BlockEnum.Iteration]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: IterationDefault.getAvailablePrevNodes,
    getAvailableNextNodes: IterationDefault.getAvailableNextNodes,
    checkValid: IterationDefault.checkValid,
  },
  [BlockEnum.Code]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: CodeDefault.getAvailablePrevNodes,
    getAvailableNextNodes: CodeDefault.getAvailableNextNodes,
    checkValid: CodeDefault.checkValid,
  },
  [BlockEnum.TemplateTransform]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: TemplateTransformDefault.getAvailablePrevNodes,
    getAvailableNextNodes: TemplateTransformDefault.getAvailableNextNodes,
    checkValid: TemplateTransformDefault.checkValid,
  },
  [BlockEnum.QuestionClassifier]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: QuestionClassifierDefault.getAvailablePrevNodes,
    getAvailableNextNodes: QuestionClassifierDefault.getAvailableNextNodes,
    checkValid: QuestionClassifierDefault.checkValid,
  },
  [BlockEnum.HttpRequest]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: HttpRequestDefault.getAvailablePrevNodes,
    getAvailableNextNodes: HttpRequestDefault.getAvailableNextNodes,
    checkValid: HttpRequestDefault.checkValid,
  },
  [BlockEnum.VariableAssigner]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: VariableAssignerDefault.getAvailablePrevNodes,
    getAvailableNextNodes: VariableAssignerDefault.getAvailableNextNodes,
    checkValid: VariableAssignerDefault.checkValid,
  },
  [BlockEnum.VariableAggregator]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: VariableAssignerDefault.getAvailablePrevNodes,
    getAvailableNextNodes: VariableAssignerDefault.getAvailableNextNodes,
    checkValid: VariableAssignerDefault.checkValid,
  },
  [BlockEnum.ParameterExtractor]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: ParameterExtractorDefault.getAvailablePrevNodes,
    getAvailableNextNodes: ParameterExtractorDefault.getAvailableNextNodes,
    checkValid: ParameterExtractorDefault.checkValid,
  },
  [BlockEnum.Tool]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: ToolDefault.getAvailablePrevNodes,
    getAvailableNextNodes: ToolDefault.getAvailableNextNodes,
    checkValid: ToolDefault.checkValid,
  },
}

export const ALL_CHAT_AVAILABLE_BLOCKS = Object.keys(NODES_EXTRA_DATA).filter(key => key !== BlockEnum.End && key !== BlockEnum.Start) as BlockEnum[]
export const ALL_COMPLETION_AVAILABLE_BLOCKS = Object.keys(NODES_EXTRA_DATA).filter(key => key !== BlockEnum.Answer && key !== BlockEnum.Start) as BlockEnum[]

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
  [BlockEnum.Iteration]: {
    type: BlockEnum.Iteration,
    title: '',
    desc: '',
    ...IterationDefault.defaultValue,
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
  [BlockEnum.ParameterExtractor]: {
    type: BlockEnum.ParameterExtractor,
    title: '',
    desc: '',
    variables: [],
    ...ParameterExtractorDefault.defaultValue,
  },
  [BlockEnum.VariableAssigner]: {
    type: BlockEnum.VariableAssigner,
    title: '',
    desc: '',
    variables: [],
    output_type: '',
    ...VariableAssignerDefault.defaultValue,
  },
  [BlockEnum.VariableAggregator]: {
    type: BlockEnum.VariableAggregator,
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

export const NODE_WIDTH = 240
export const X_OFFSET = 60
export const NODE_WIDTH_X_OFFSET = NODE_WIDTH + X_OFFSET
export const Y_OFFSET = 39
export const MAX_TREE_DEPTH = 50
export const START_INITIAL_POSITION = { x: 80, y: 282 }
export const AUTO_LAYOUT_OFFSET = {
  x: -42,
  y: 243,
}
export const ITERATION_NODE_Z_INDEX = 1
export const ITERATION_CHILDREN_Z_INDEX = 1002
export const ITERATION_PADDING = {
  top: 85,
  right: 16,
  bottom: 20,
  left: 16,
}

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
  BlockEnum.HttpRequest, BlockEnum.Tool, BlockEnum.VariableAssigner, BlockEnum.VariableAggregator, BlockEnum.QuestionClassifier,
  BlockEnum.ParameterExtractor, BlockEnum.Iteration,
]

export const LLM_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'text',
    type: VarType.string,
  },
]

export const KNOWLEDGE_RETRIEVAL_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'result',
    type: VarType.arrayObject,
  },
]

export const TEMPLATE_TRANSFORM_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'output',
    type: VarType.string,
  },
]

export const QUESTION_CLASSIFIER_OUTPUT_STRUCT = [
  {
    variable: 'class_name',
    type: VarType.string,
  },
]

export const HTTP_REQUEST_OUTPUT_STRUCT: Var[] = [
  {
    variable: 'body',
    type: VarType.string,
  },
  {
    variable: 'status_code',
    type: VarType.number,
  },
  {
    variable: 'headers',
    type: VarType.object,
  },
  {
    variable: 'files',
    type: VarType.arrayFile,
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
  {
    variable: 'json',
    type: VarType.arrayObject,
  },
]

export const PARAMETER_EXTRACTOR_COMMON_STRUCT: Var[] = [
  {
    variable: '__is_success',
    type: VarType.number,
  },
  {
    variable: '__reason',
    type: VarType.string,
  },
]

export const WORKFLOW_DATA_UPDATE = 'WORKFLOW_DATA_UPDATE'
export const CUSTOM_NODE = 'custom'
export const DSL_EXPORT_CHECK = 'DSL_EXPORT_CHECK'
