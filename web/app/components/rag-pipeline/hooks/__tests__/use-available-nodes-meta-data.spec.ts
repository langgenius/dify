import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableNodesMetaData } from '../use-available-nodes-meta-data'

const mockIsAgentV2Enabled = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.dify.ai${path || ''}`,
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
}))

it.each([true, false])('offers the pipeline node catalog with Agent v2 enabled=%s', (enabled) => {
  mockIsAgentV2Enabled.mockReturnValue(enabled)
  const { result } = renderHook(() => useAvailableNodesMetaData())
  const { nodes, nodesMap } = result.current
  const types = nodes.map((node) => node.metaData.type)
  expect(types).toEqual(
    expect.arrayContaining([
      BlockEnum.LLM,
      BlockEnum.HttpRequest,
      BlockEnum.DataSource,
      BlockEnum.KnowledgeBase,
      BlockEnum.DataSourceEmpty,
      enabled ? BlockEnum.AgentV2 : BlockEnum.Agent,
    ]),
  )
  expect(types).not.toContain(BlockEnum.HumanInput)
  expect(types).not.toContain(enabled ? BlockEnum.Agent : BlockEnum.AgentV2)
  expect(nodesMap[enabled ? BlockEnum.Agent : BlockEnum.AgentV2]).toBeUndefined()
  expect(nodesMap[BlockEnum.DataSource]?.defaultValue).toMatchObject({
    _dataSourceStartToAdd: true,
  })
  expect(nodesMap[BlockEnum.VariableAssigner]).toBe(nodesMap[BlockEnum.VariableAggregator])
  for (const node of nodes) {
    const type = node.metaData.type
    expect(nodesMap[type]).toBe(node)
    expect(node.metaData).toMatchObject({
      title: `workflow.blocks.${type}`,
      description: `workflow.blocksAbout.${type}`,
      helpLinkUri:
        'https://docs.dify.ai/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration',
    })
    expect(node.defaultValue).toMatchObject({
      type: type === BlockEnum.AgentV2 ? BlockEnum.Agent : type,
      title: `workflow.blocks.${type}`,
    })
  }
})
