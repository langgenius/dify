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
import AssignerDefault from './nodes/assigner/default'
import EndNodeDefault from './nodes/end/default'
import IterationDefault from './nodes/iteration/default'
import LoopDefault from './nodes/loop/default'
import DocExtractorDefault from './nodes/document-extractor/default'
import ListFilterDefault from './nodes/list-operator/default'
import IterationStartDefault from './nodes/iteration-start/default'
import AgentDefault from './nodes/agent/default'
import LoopStartDefault from './nodes/loop-start/default'

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
  [BlockEnum.IterationStart]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: IterationStartDefault.getAvailablePrevNodes,
    getAvailableNextNodes: IterationStartDefault.getAvailableNextNodes,
    checkValid: IterationStartDefault.checkValid,
  },
  [BlockEnum.Loop]: {
    author: 'AICT-Team',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: LoopDefault.getAvailablePrevNodes,
    getAvailableNextNodes: LoopDefault.getAvailableNextNodes,
    checkValid: LoopDefault.checkValid,
  },
  [BlockEnum.LoopStart]: {
    author: 'AICT-Team',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: LoopStartDefault.getAvailablePrevNodes,
    getAvailableNextNodes: LoopStartDefault.getAvailableNextNodes,
    checkValid: LoopStartDefault.checkValid,
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
  [BlockEnum.Assigner]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: AssignerDefault.getAvailablePrevNodes,
    getAvailableNextNodes: AssignerDefault.getAvailableNextNodes,
    checkValid: AssignerDefault.checkValid,
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
  [BlockEnum.DocExtractor]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: DocExtractorDefault.getAvailablePrevNodes,
    getAvailableNextNodes: DocExtractorDefault.getAvailableNextNodes,
    checkValid: DocExtractorDefault.checkValid,
  },
  [BlockEnum.ListFilter]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: ListFilterDefault.getAvailablePrevNodes,
    getAvailableNextNodes: ListFilterDefault.getAvailableNextNodes,
    checkValid: ListFilterDefault.checkValid,
  },
  [BlockEnum.Agent]: {
    author: 'Dify',
    about: '',
    availablePrevNodes: [],
    availableNextNodes: [],
    getAvailablePrevNodes: ListFilterDefault.getAvailablePrevNodes,
    getAvailableNextNodes: ListFilterDefault.getAvailableNextNodes,
    checkValid: AgentDefault.checkValid,
  },
}

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
  [BlockEnum.IterationStart]: {
    type: BlockEnum.IterationStart,
    title: '',
    desc: '',
    ...IterationStartDefault.defaultValue,
  },
  [BlockEnum.Loop]: {
    type: BlockEnum.Loop,
    title: '',
    desc: '',
    ...LoopDefault.defaultValue,
  },
  [BlockEnum.LoopStart]: {
    type: BlockEnum.LoopStart,
    title: '',
    desc: '',
    ...LoopStartDefault.defaultValue,
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
  [BlockEnum.Assigner]: {
    type: BlockEnum.Assigner,
    title: '',
    desc: '',
    ...AssignerDefault.defaultValue,
  },
  [BlockEnum.Tool]: {
    type: BlockEnum.Tool,
    title: '',
    desc: '',
    ...ToolDefault.defaultValue,
  },
  [BlockEnum.DocExtractor]: {
    type: BlockEnum.DocExtractor,
    title: '',
    desc: '',
    ...DocExtractorDefault.defaultValue,
  },
  [BlockEnum.ListFilter]: {
    type: BlockEnum.ListFilter,
    title: '',
    desc: '',
    ...ListFilterDefault.defaultValue,
  },
  [BlockEnum.Agent]: {
    type: BlockEnum.Agent,
    title: '',
    desc: '',
    ...AgentDefault.defaultValue,
  },
}
export const MAX_ITERATION_PARALLEL_NUM = 10
export const MIN_ITERATION_PARALLEL_NUM = 1
export const DEFAULT_ITER_TIMES = 1
export const DEFAULT_LOOP_TIMES = 1
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
  top: 65,
  right: 16,
  bottom: 20,
  left: 16,
}

export const LOOP_NODE_Z_INDEX = 1
export const LOOP_CHILDREN_Z_INDEX = 1002
export const LOOP_PADDING = {
  top: 65,
  right: 16,
  bottom: 20,
  left: 16,
}

export const PARALLEL_LIMIT = 10
export const PARALLEL_DEPTH_LIMIT = 3

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
  BlockEnum.ParameterExtractor, BlockEnum.Iteration, BlockEnum.Loop,
  BlockEnum.DocExtractor, BlockEnum.ListFilter,
  BlockEnum.Agent,
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

export const FILE_STRUCT: Var[] = [
  {
    variable: 'name',
    type: VarType.string,
  },
  {
    variable: 'size',
    type: VarType.number,
  },
  {
    variable: 'type',
    type: VarType.string,
  },
  {
    variable: 'extension',
    type: VarType.string,
  },
  {
    variable: 'mime_type',
    type: VarType.string,
  },
  {
    variable: 'transfer_method',
    type: VarType.string,
  },
  {
    variable: 'url',
    type: VarType.string,
  },
]

export const DEFAULT_FILE_UPLOAD_SETTING = {
  allowed_file_upload_methods: ['local_file', 'remote_url'],
  max_length: 5,
  allowed_file_types: ['image'],
  allowed_file_extensions: [],
}

export const WORKFLOW_DATA_UPDATE = 'WORKFLOW_DATA_UPDATE'
export const CUSTOM_NODE = 'custom'
export const CUSTOM_EDGE = 'custom'
export const DSL_EXPORT_CHECK = 'DSL_EXPORT_CHECK'
export const DEFAULT_RETRY_MAX = 3
export const DEFAULT_RETRY_INTERVAL = 100
