import type { Block } from '../types'
import { BlockEnum } from '../types'

export const TABS = [
  {
    key: 'blocks',
    name: 'Blocks',
  },
  {
    key: 'built-in-tool',
    name: 'Built-in Tool',
  },
  {
    key: 'custom-tool',
    name: 'Custom Tool',
  },
]

export const BLOCKS: Block[] = [
  {
    type: BlockEnum.Start,
    title: 'Start',
    description: '',
  },
  {
    type: BlockEnum.LLM,
    title: 'LLM',
  },
  {
    type: BlockEnum.End,
    title: 'End',
  },
  {
    type: BlockEnum.DirectAnswer,
    title: 'Direct Answer',
  },
  {
    classification: 'Question Understand',
    type: BlockEnum.KnowledgeRetrieval,
    title: 'Knowledge Retrieval',
  },
  {
    classification: 'Question Understand',
    type: BlockEnum.QuestionClassifier,
    title: 'Question Classifier',
  },
  {
    classification: 'Logic',
    type: BlockEnum.IfElse,
    title: 'IF/ELSE',
  },
  {
    classification: 'Transform',
    type: BlockEnum.Code,
    title: 'Code',
  },
  {
    classification: 'Transform',
    type: BlockEnum.TemplateTransform,
    title: 'Templating Transform',
  },
  {
    classification: 'Transform',
    type: BlockEnum.VariableAssigner,
    title: 'Variable Assigner',
  },
  {
    classification: 'Utilities',
    type: BlockEnum.HttpRequest,
    title: 'HTTP Request',
  },
]
