import type { AgentSubGraphProps, AssembleSubGraphProps } from '../types'
import type { NestedNodeConfig } from '@/app/components/workflow/nodes/_base/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Node, ValueSelector } from '@/app/components/workflow/types'
import { describe, expect, it, vi } from 'vitest'
import { NULL_STRATEGY } from '@/app/components/workflow/nodes/_base/constants'
import { BlockEnum, EditionType, PromptRole } from '@/app/components/workflow/types'
import {
  buildSubGraphEdges,
  buildSubGraphExtractorDisplayNode,
  buildSubGraphStartNode,
  getSubGraphExtractorNodeId,
  getSubGraphPromptText,
  getSubGraphSourceTitle,
} from '../utils'

const nestedNodeConfig: NestedNodeConfig = {
  extractor_node_id: 'extractor-1',
  output_selector: ['extractor-1', 'output'],
  null_strategy: NULL_STRATEGY.RAISE_ERROR,
  default_value: '',
}

const sourceVariable = ['agent-1', 'context'] as ValueSelector
const assembleExtractorNode = {
  id: 'extractor-1',
  data: { selected: true },
} as Node<CodeNodeType>
const agentExtractorNode = {
  id: 'extractor-1',
  data: {
    selected: true,
    prompt_template: [
      { role: PromptRole.system, text: 'keep me' },
      { role: PromptRole.user, text: 'replace me', edition_type: EditionType.jinja2 },
    ],
  },
} as Node<LLMNodeType>

const createAssembleProps = (): AssembleSubGraphProps => ({
  variant: 'assemble',
  title: 'Assembler',
  isOpen: true,
  toolNodeId: 'tool-node',
  paramKey: 'question',
  nestedNodeConfig,
  onNestedNodeConfigChange: vi.fn(),
  extractorNode: assembleExtractorNode,
})

const createAgentProps = (): AgentSubGraphProps => ({
  variant: 'agent',
  isOpen: true,
  toolNodeId: 'agent-tool',
  paramKey: 'context',
  toolParamValue: '{{#agent-1.context#}}hello world',
  agentNodeId: 'agent-1',
  agentName: 'Agent Runner',
  sourceVariable,
  nestedNodeConfig,
  onNestedNodeConfigChange: vi.fn(),
  extractorNode: agentExtractorNode,
})

describe('sub-graph utils', () => {
  it('should resolve titles and extractor ids from the sub-graph props', () => {
    expect(getSubGraphSourceTitle(createAssembleProps())).toBe('Assembler')
    expect(getSubGraphSourceTitle(createAgentProps())).toBe('Agent Runner')
    expect(getSubGraphExtractorNodeId(createAgentProps())).toBe('agent-tool_ext_context')
  })

  it('should strip the injected agent context prefix from the prompt text', () => {
    expect(getSubGraphPromptText(createAgentProps())).toBe('hello world')
    expect(getSubGraphPromptText(createAssembleProps())).toBe('')
  })

  it('should build the correct start node shape for each variant', () => {
    expect(buildSubGraphStartNode(createAssembleProps(), 'Assembler').data.iconType).toBe('assemble')
    expect(buildSubGraphStartNode(createAgentProps(), 'Agent Runner').data.iconType).toBe('agent')
  })

  it('should apply the agent prompt text to the extractor display node', () => {
    const extractorDisplayNode = buildSubGraphExtractorDisplayNode(createAgentProps(), 'hello world')

    expect(extractorDisplayNode?.data.selected).toBe(false)
    expect(extractorDisplayNode?.data.prompt_template).toEqual([
      { role: PromptRole.system, text: 'keep me' },
      { role: PromptRole.user, text: 'hello world', edition_type: EditionType.jinja2, jinja2_text: 'hello world' },
    ])
  })

  it('should preserve the assemble extractor payload without prompt rewrites', () => {
    const extractorDisplayNode = buildSubGraphExtractorDisplayNode(createAssembleProps(), '')

    expect(extractorDisplayNode?.data.selected).toBe(false)
    expect((extractorDisplayNode?.data as Record<string, unknown> | undefined)?.prompt_template).toBeUndefined()
  })

  it('should build edges targeting the correct block type for each variant', () => {
    const agentProps = createAgentProps()
    const assembleProps = createAssembleProps()
    const agentStartNode = buildSubGraphStartNode(agentProps, 'Agent Runner')
    const assembleStartNode = buildSubGraphStartNode(assembleProps, 'Assembler')
    const agentExtractor = buildSubGraphExtractorDisplayNode(agentProps, 'hello world')
    const assembleExtractor = buildSubGraphExtractorDisplayNode(assembleProps, '')

    expect(buildSubGraphEdges(agentProps, agentStartNode, agentExtractor)[0].data.targetType).toBe(BlockEnum.LLM)
    expect(buildSubGraphEdges(assembleProps, assembleStartNode, assembleExtractor)[0].data.targetType).toBe(BlockEnum.Code)
  })
})
