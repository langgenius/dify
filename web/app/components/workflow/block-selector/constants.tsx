import type { Block } from '../types'
import { BlockEnum } from '../types'
import { BlockClassification } from './types'

export const BLOCK_CLASSIFICATIONS = [
  BlockClassification.Default,
  BlockClassification.QuestionUnderstand,
  BlockClassification.Logic,
  BlockClassification.Transform,
  BlockClassification.Utilities,
] as const

export const DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE = [
  'txt',
  'markdown',
  'mdx',
  'pdf',
  'html',
  'xlsx',
  'xls',
  'vtt',
  'properties',
  'doc',
  'docx',
  'csv',
  'eml',
  'msg',
  'pptx',
  'xml',
  'epub',
  'ppt',
  'md',
]

export const START_BLOCKS = [
  {
    classification: BlockClassification.Default,
    type: BlockEnum.Start,
    title: 'User Input',
    description: 'Traditional start node for user input',
  },
  {
    classification: BlockClassification.Default,
    type: BlockEnum.TriggerSchedule,
    title: 'Schedule Trigger',
    description: 'Time-based workflow trigger',
  },
  {
    classification: BlockClassification.Default,
    type: BlockEnum.TriggerWebhook,
    title: 'Webhook Trigger',
    description: 'HTTP callback trigger',
  },
] as const satisfies readonly Block[]

export const ENTRY_NODE_TYPES = [
  BlockEnum.Start,
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
] as const

export const BLOCKS = [
  {
    classification: BlockClassification.Default,
    type: BlockEnum.Agent,
    title: 'Agent',
  },
  {
    classification: BlockClassification.Default,
    type: BlockEnum.AgentV2,
    title: 'Agent',
  },
  {
    classification: BlockClassification.Default,
    type: BlockEnum.LLM,
    title: 'LLM',
  },
  {
    classification: BlockClassification.Default,
    type: BlockEnum.KnowledgeRetrieval,
    title: 'Knowledge Retrieval',
  },
  {
    classification: BlockClassification.Default,
    type: BlockEnum.End,
    title: 'End',
  },
  {
    classification: BlockClassification.Default,
    type: BlockEnum.Answer,
    title: 'Direct Answer',
  },
  {
    classification: BlockClassification.QuestionUnderstand,
    type: BlockEnum.QuestionClassifier,
    title: 'Question Classifier',
  },
  {
    classification: BlockClassification.Logic,
    type: BlockEnum.IfElse,
    title: 'IF/ELSE',
  },
  {
    classification: BlockClassification.Logic,
    type: BlockEnum.LoopEnd,
    title: 'Exit Loop',
    description: '',
  },
  {
    classification: BlockClassification.Logic,
    type: BlockEnum.Iteration,
    title: 'Iteration',
  },
  {
    classification: BlockClassification.Logic,
    type: BlockEnum.Loop,
    title: 'Loop',
  },
  {
    classification: BlockClassification.Transform,
    type: BlockEnum.Code,
    title: 'Code',
  },
  {
    classification: BlockClassification.Transform,
    type: BlockEnum.TemplateTransform,
    title: 'Templating Transform',
  },
  {
    classification: BlockClassification.Transform,
    type: BlockEnum.VariableAggregator,
    title: 'Variable Aggregator',
  },
  {
    classification: BlockClassification.Transform,
    type: BlockEnum.DocExtractor,
    title: 'Doc Extractor',
  },
  {
    classification: BlockClassification.Transform,
    type: BlockEnum.Assigner,
    title: 'Variable Assigner',
  },
  {
    classification: BlockClassification.Transform,
    type: BlockEnum.ParameterExtractor,
    title: 'Parameter Extractor',
  },
  {
    classification: BlockClassification.Utilities,
    type: BlockEnum.HttpRequest,
    title: 'HTTP Request',
  },
  {
    classification: BlockClassification.Utilities,
    type: BlockEnum.ListFilter,
    title: 'List Filter',
  },
] as const satisfies readonly Block[]
