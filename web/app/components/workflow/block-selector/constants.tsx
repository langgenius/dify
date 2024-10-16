import type { Block } from '../types'
import { BlockEnum } from '../types'
import { BlockClassificationEnum } from './types'

export const BLOCKS: Block[] = [
  {
    classification: BlockClassificationEnum.Default,
    type: BlockEnum.Start,
    title: 'Start',
    description: '',
  },
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
    type: BlockEnum.Iteration,
    title: 'Iteration',
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
]

export const BLOCK_CLASSIFICATIONS: string[] = [
  BlockClassificationEnum.Default,
  BlockClassificationEnum.QuestionUnderstand,
  BlockClassificationEnum.Logic,
  BlockClassificationEnum.Transform,
  BlockClassificationEnum.Utilities,
]
