import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableNodesMetaData } from '../use-available-nodes-meta-data'

const mockIsAgentV2Enabled = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.dify.ai${path || ''}`,
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
}))

vi.mock('@/app/components/workflow/constants/node', () => ({
  WORKFLOW_COMMON_NODES: [
    {
      metaData: { type: BlockEnum.LLM },
      defaultValue: { title: 'LLM' },
    },
    {
      metaData: { type: BlockEnum.HumanInput },
      defaultValue: { title: 'Human Input' },
    },
    {
      metaData: { type: BlockEnum.HttpRequest },
      defaultValue: { title: 'HTTP Request' },
    },
    {
      metaData: { type: BlockEnum.Agent },
      defaultValue: { title: 'Agent' },
    },
    {
      metaData: { type: BlockEnum.AgentV2 },
      defaultValue: { title: 'Agent' },
    },
  ],
}))

vi.mock('@/app/components/workflow/nodes/data-source-empty/default', () => ({
  default: {
    metaData: { type: BlockEnum.DataSourceEmpty },
    defaultValue: { title: 'Data Source Empty' },
  },
}))

vi.mock('@/app/components/workflow/nodes/data-source/default', () => ({
  default: {
    metaData: { type: BlockEnum.DataSource },
    defaultValue: { title: 'Data Source' },
  },
}))

vi.mock('@/app/components/workflow/nodes/knowledge-base/default', () => ({
  default: {
    metaData: { type: BlockEnum.KnowledgeBase },
    defaultValue: { title: 'Knowledge Base' },
  },
}))

describe('useAvailableNodesMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAgentV2Enabled.mockReturnValue(true)
  })

  it('should return nodes and nodesMap', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())

    expect(result.current.nodes).toBeDefined()
    expect(result.current.nodesMap).toBeDefined()
  })

  it('should filter out HumanInput node', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map((n) => n.metaData.type)

    expect(nodeTypes).not.toContain(BlockEnum.HumanInput)
  })

  it('should include DataSource with _dataSourceStartToAdd flag', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const dsNode = result.current.nodes.find((n) => n.metaData.type === BlockEnum.DataSource)

    expect(dsNode).toBeDefined()
    expect(dsNode!.defaultValue._dataSourceStartToAdd).toBe(true)
  })

  it('should include KnowledgeBase and DataSourceEmpty nodes', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map((n) => n.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.KnowledgeBase)
    expect(nodeTypes).toContain(BlockEnum.DataSourceEmpty)
  })

  it('should translate title and description for each node', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())

    result.current.nodes.forEach((node) => {
      expect(node.metaData.title).toMatch(/^workflow\.blocks\./)
      expect(node.metaData.description).toMatch(/^workflow\.blocksAbout\./)
    })
  })

  it('should set helpLinkUri on each node metaData', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())

    result.current.nodes.forEach((node) => {
      expect(node.metaData.helpLinkUri).toContain('https://docs.dify.ai')
      expect(node.metaData.helpLinkUri).toContain('knowledge-pipeline')
    })
  })

  it('should set type and title on defaultValue', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())

    result.current.nodes.forEach((node) => {
      expect(node.defaultValue.type).toBe(
        node.metaData.type === BlockEnum.AgentV2 ? BlockEnum.Agent : node.metaData.type,
      )
      expect(node.defaultValue.title).toBe(node.metaData.title)
    })
  })

  it('should build nodesMap indexed by BlockEnum type', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const { nodesMap } = result.current

    expect(nodesMap[BlockEnum.LLM]).toBeDefined()
    expect(nodesMap[BlockEnum.DataSource]).toBeDefined()
    expect(nodesMap[BlockEnum.KnowledgeBase]).toBeDefined()
  })

  it('should alias VariableAssigner to VariableAggregator in nodesMap', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const { nodesMap } = result.current

    expect(nodesMap[BlockEnum.VariableAssigner]).toBe(nodesMap[BlockEnum.VariableAggregator])
  })

  it('should include common nodes except HumanInput', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map((n) => n.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.LLM)
    expect(nodeTypes).toContain(BlockEnum.HttpRequest)
    expect(nodeTypes).not.toContain(BlockEnum.HumanInput)
  })

  it('should expose Agent v2 instead of legacy Agent when Agent v2 is enabled', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map((n) => n.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.AgentV2)
    expect(nodeTypes).not.toContain(BlockEnum.Agent)
    expect(result.current.nodesMap[BlockEnum.AgentV2]).toBeDefined()
    expect(result.current.nodesMap[BlockEnum.Agent]).toBeUndefined()
  })

  it('should expose legacy Agent instead of Agent v2 when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)

    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map((n) => n.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.Agent)
    expect(nodeTypes).not.toContain(BlockEnum.AgentV2)
    expect(result.current.nodesMap[BlockEnum.Agent]).toBeDefined()
    expect(result.current.nodesMap[BlockEnum.AgentV2]).toBeUndefined()
  })
})
