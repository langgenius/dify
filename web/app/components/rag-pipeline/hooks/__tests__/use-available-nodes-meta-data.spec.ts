import { renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableNodesMetaData } from '../use-available-nodes-meta-data'

const mockIsAgentV2Enabled = vi.hoisted(() => vi.fn(() => true))
const mockKnowledgeFsEnabled = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/features/knowledge-fs-availability/state', async () => {
  const { atom } = await import('jotai')
  return { knowledgeFsEnabledAtom: atom(() => mockKnowledgeFsEnabled()) }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.dify.ai${path || ''}`,
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
}))

describe('useAvailableNodesMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAgentV2Enabled.mockReturnValue(true)
    mockKnowledgeFsEnabled.mockReturnValue(true)
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
    expect(nodeTypes).toContain(BlockEnum.KnowledgeRetrievalV2)
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

  it('should hide Knowledge Retrieval V2 when KnowledgeFS is unavailable', () => {
    mockKnowledgeFsEnabled.mockReturnValue(false)
    // A fresh store re-reads the flag instead of reusing the default store's cached value.
    const store = createStore()
    const { result } = renderHook(() => useAvailableNodesMetaData(), {
      wrapper: ({ children }) => createElement(Provider, { store }, children),
    })
    const nodeTypes = result.current.nodes.map((node) => node.metaData.type)

    expect(nodeTypes).not.toContain(BlockEnum.KnowledgeRetrievalV2)
    expect(result.current.nodesMap[BlockEnum.KnowledgeRetrievalV2]).toBeUndefined()
  })
})
