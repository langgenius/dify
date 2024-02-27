import { BlockEnum } from './types'

export const NodeInitialData = {
  [BlockEnum.Start]: {
    type: BlockEnum.Start,
    title: '',
    desc: '',
    variables: [],
  },
  [BlockEnum.End]: {
    type: BlockEnum.End,
    title: '',
    desc: '',
    outputs: {},
  },
  [BlockEnum.DirectAnswer]: {
    type: BlockEnum.DirectAnswer,
    title: '',
    desc: '',
    variables: [],
  },
  [BlockEnum.LLM]: {
    type: BlockEnum.LLM,
    title: '',
    desc: '',
    variables: [],
  },
  [BlockEnum.KnowledgeRetrieval]: {
    type: BlockEnum.KnowledgeRetrieval,
    title: '',
    desc: '',
    query_variable_selector: [],
    dataset_ids: [],
    retrieval_mode: 'single',
  },
  [BlockEnum.IfElse]: {
    branches: [
      {
        id: 'if-true',
        name: 'IS TRUE',
      },
      {
        id: 'if-false',
        name: 'IS FALSE',
      },
    ],
    type: BlockEnum.IfElse,
    title: '',
    desc: '',
    logical_operator: 'and',
    conditions: [],
  },
  [BlockEnum.Code]: {
    type: BlockEnum.Code,
    title: '',
    desc: '',
    variables: [],
    code_language: 'python3',
    code: '',
    outputs: [],
  },
  [BlockEnum.TemplateTransform]: {
    type: BlockEnum.TemplateTransform,
    title: '',
    desc: '',
    variables: [],
    template: '',
  },
  [BlockEnum.QuestionClassifier]: {
    type: BlockEnum.QuestionClassifier,
    title: '',
    desc: '',
    query_variable_selector: [],
    topics: [],
  },
  [BlockEnum.HttpRequest]: {
    type: BlockEnum.HttpRequest,
    title: '',
    desc: '',
    variables: [],
  },
  [BlockEnum.VariableAssigner]: {
    type: BlockEnum.VariableAssigner,
    title: '',
    desc: '',
    variables: [],
    output_type: '',
  },
  [BlockEnum.Tool]: {
    type: BlockEnum.Tool,
    title: '',
    desc: '',
  },
}
