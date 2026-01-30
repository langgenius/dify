import agentDefault from '@/app/components/workflow/nodes/agent/default'
import assignerDefault from '@/app/components/workflow/nodes/assigner/default'
import codeDefault from '@/app/components/workflow/nodes/code/default'

import documentExtractorDefault from '@/app/components/workflow/nodes/document-extractor/default'

import httpRequestDefault from '@/app/components/workflow/nodes/http/default'
import ifElseDefault from '@/app/components/workflow/nodes/if-else/default'
import iterationStartDefault from '@/app/components/workflow/nodes/iteration-start/default'
import iterationDefault from '@/app/components/workflow/nodes/iteration/default'
import knowledgeRetrievalDefault from '@/app/components/workflow/nodes/knowledge-retrieval/default'
import listOperatorDefault from '@/app/components/workflow/nodes/list-operator/default'

import llmDefault from '@/app/components/workflow/nodes/llm/default'
import loopEndDefault from '@/app/components/workflow/nodes/loop-end/default'
import loopStartDefault from '@/app/components/workflow/nodes/loop-start/default'
import loopDefault from '@/app/components/workflow/nodes/loop/default'
import parameterExtractorDefault from '@/app/components/workflow/nodes/parameter-extractor/default'
import questionClassifierDefault from '@/app/components/workflow/nodes/question-classifier/default'
import templateTransformDefault from '@/app/components/workflow/nodes/template-transform/default'
import toolDefault from '@/app/components/workflow/nodes/tool/default'
import variableAggregatorDefault from '@/app/components/workflow/nodes/variable-assigner/default'

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
]
