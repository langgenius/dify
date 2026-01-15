import type { Block } from '../types'
import { BlockEnum } from '../types'
import { BlockClassificationEnum } from './types'

export const BLOCK_CLASSIFICATIONS = [
  BlockClassificationEnum.Default,
  BlockClassificationEnum.QuestionUnderstand,
  BlockClassificationEnum.Logic,
  BlockClassificationEnum.Transform,
  BlockClassificationEnum.Utilities,
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
    classification: BlockClassificationEnum.Default,
    type: BlockEnum.Start,
    title: 'User Input',
    description: 'Traditional start node for user input',
  },
  {
    classification: BlockClassificationEnum.Default,
    type: BlockEnum.TriggerSchedule,
    title: 'Schedule Trigger',
    description: 'Time-based workflow trigger',
  },
  {
    classification: BlockClassificationEnum.Default,
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
    classification: BlockClassificationEnum.Default,
    type: BlockEnum.LLM,
    title: 'LLM',
  },
  {
    classification: BlockClassificationEnum.Default,
    type: BlockEnum.KnowledgeRetrieval,
    title: 'Knowledge Retrieval',
  },
  {
    classification: BlockClassificationEnum.Default,
    type: BlockEnum.End,
    title: 'End',
  },
  {
    classification: BlockClassificationEnum.Default,
    type: BlockEnum.Answer,
    title: 'Direct Answer',
  },
  {
    classification: BlockClassificationEnum.QuestionUnderstand,
    type: BlockEnum.QuestionClassifier,
    title: 'Question Classifier',
  },
  {
    classification: BlockClassificationEnum.Logic,
    type: BlockEnum.IfElse,
    title: 'IF/ELSE',
  },
  {
    classification: BlockClassificationEnum.Logic,
    type: BlockEnum.LoopEnd,
    title: 'Exit Loop',
    description: '',
  },
  {
    classification: BlockClassificationEnum.Logic,
    type: BlockEnum.Iteration,
    title: 'Iteration',
  },
  {
    classification: BlockClassificationEnum.Logic,
    type: BlockEnum.Loop,
    title: 'Loop',
  },
  {
    classification: BlockClassificationEnum.Transform,
    type: BlockEnum.Code,
    title: 'Code',
  },
  {
    classification: BlockClassificationEnum.Transform,
    type: BlockEnum.TemplateTransform,
    title: 'Templating Transform',
  },
  {
    classification: BlockClassificationEnum.Transform,
    type: BlockEnum.VariableAggregator,
    title: 'Variable Aggregator',
  },
  {
    classification: BlockClassificationEnum.Transform,
    type: BlockEnum.DocExtractor,
    title: 'Doc Extractor',
  },
  {
    classification: BlockClassificationEnum.Transform,
    type: BlockEnum.Assigner,
    title: 'Variable Assigner',
  },
  {
    classification: BlockClassificationEnum.Transform,
    type: BlockEnum.ParameterExtractor,
    title: 'Parameter Extractor',
  },
  {
    classification: BlockClassificationEnum.Utilities,
    type: BlockEnum.HttpRequest,
    title: 'HTTP Request',
  },
  {
    classification: BlockClassificationEnum.Utilities,
    type: BlockEnum.ListFilter,
    title: 'List Filter',
  },
  {
    classification: BlockClassificationEnum.Default,
    type: BlockEnum.Agent,
    title: 'Agent',
  },
] as const satisfies readonly Block[]
