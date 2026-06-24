import { renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableNodesMetaData } from '../use-available-nodes-meta-data'

const mockUseIsChatMode = vi.fn()
const mockIsAgentV2Enabled = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/app/components/workflow-app/hooks/use-is-chat-mode', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `/docs${path}`,
}))

describe('useAvailableNodesMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAgentV2Enabled.mockReturnValue(true)
  })

  it('should include chat-specific nodes and make the start node undeletable in chat mode', () => {
    mockUseIsChatMode.mockReturnValue(true)

    const { result } = renderHook(() => useAvailableNodesMetaData())

    expect(result.current.nodesMap?.[BlockEnum.Start]?.metaData.isUndeletable).toBe(true)
    expect(result.current.nodesMap?.[BlockEnum.Answer]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.End]).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.TriggerWebhook]).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.VariableAssigner]).toBe(result.current.nodesMap?.[BlockEnum.VariableAggregator])
    expect(result.current.nodesMap?.[BlockEnum.Start]?.metaData.helpLinkUri).toContain('/docs/use-dify/nodes/')
  })

  it('should include workflow-specific trigger and end nodes outside chat mode', () => {
    mockUseIsChatMode.mockReturnValue(false)

    const { result } = renderHook(() => useAvailableNodesMetaData())

    expect(result.current.nodesMap?.[BlockEnum.Start]?.metaData.isUndeletable).toBe(false)
    expect(result.current.nodesMap?.[BlockEnum.End]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.StartPlaceholder]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.TriggerWebhook]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.TriggerSchedule]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.TriggerPlugin]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.Answer]).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.Start]?.defaultValue).toMatchObject({
      type: BlockEnum.Start,
      title: 'workflow.blocks.start',
    })
  })

  it('should use explicit docs pages and skip nodes without generated docs pages', () => {
    mockUseIsChatMode.mockReturnValue(false)

    const { result } = renderHook(() => useAvailableNodesMetaData())

    expect(result.current.nodesMap?.[BlockEnum.End]?.metaData.helpLinkUri).toBe('/docs/use-dify/nodes/output')
    expect(result.current.nodesMap?.[BlockEnum.IterationStart]?.metaData.helpLinkUri).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.LoopStart]?.metaData.helpLinkUri).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.LoopEnd]?.metaData.helpLinkUri).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.Start]?.metaData.helpLinkUri).toBe('/docs/use-dify/nodes/user-input')
  })

  it('should expose Agent v2 instead of legacy Agent when Agent v2 is enabled', () => {
    mockUseIsChatMode.mockReturnValue(false)

    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.AgentV2)
    expect(nodeTypes).not.toContain(BlockEnum.Agent)
    expect(result.current.nodesMap?.[BlockEnum.AgentV2]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.Agent]).toBeUndefined()
  })

  it('should expose legacy Agent instead of Agent v2 when Agent v2 is disabled', () => {
    mockUseIsChatMode.mockReturnValue(false)
    mockIsAgentV2Enabled.mockReturnValue(false)

    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.Agent)
    expect(nodeTypes).not.toContain(BlockEnum.AgentV2)
    expect(result.current.nodesMap?.[BlockEnum.Agent]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.AgentV2]).toBeUndefined()
  })
})
