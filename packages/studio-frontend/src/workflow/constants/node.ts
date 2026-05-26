import agentDefault from '../nodes/agent/default'
import assignerDefault from '../nodes/assigner/default'
import codeDefault from '../nodes/code/default'

import documentExtractorDefault from '../nodes/document-extractor/default'

import httpRequestDefault from '../nodes/http/default'
import humanInputDefault from '../nodes/human-input/default'
import ifElseDefault from '../nodes/if-else/default'
import iterationStartDefault from '../nodes/iteration-start/default'
import iterationDefault from '../nodes/iteration/default'
import knowledgeRetrievalDefault from '../nodes/knowledge-retrieval/default'

import listOperatorDefault from '../nodes/list-operator/default'
import llmDefault from '../nodes/llm/default'
import loopEndDefault from '../nodes/loop-end/default'
import loopStartDefault from '../nodes/loop-start/default'
import loopDefault from '../nodes/loop/default'
import parameterExtractorDefault from '../nodes/parameter-extractor/default'
import questionClassifierDefault from '../nodes/question-classifier/default'
import templateTransformDefault from '../nodes/template-transform/default'
import toolDefault from '../nodes/tool/default'
import variableAggregatorDefault from '../nodes/variable-assigner/default'

export const WORKFLOW_COMMON_NODES = [
  llmDefault,
  knowledgeRetrievalDefault,
  agentDefault,
  questionClassifierDefault,
  ifElseDefault,
  iterationDefault,
  iterationStartDefault,
  loopDefault,
  loopStartDefault,
  loopEndDefault,
  codeDefault,
  templateTransformDefault,
  variableAggregatorDefault,
  documentExtractorDefault,
  assignerDefault,
  parameterExtractorDefault,
  httpRequestDefault,
  listOperatorDefault,
  toolDefault,
  humanInputDefault,
]
