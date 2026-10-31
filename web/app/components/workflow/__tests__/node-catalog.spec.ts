import { act } from '@testing-library/react'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useWorkflowNodeCatalog } from '@/app/components/workflow/node-catalog'
import { createDefaultFormInputByType } from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNode } from './fixtures'

// The node catalog reads KnowledgeFS availability from the console features query.
const catalogQueryClient = ({ enabled = true } = {}) =>
  createConsoleQueryWrapper({ features: { enable_knowledge_fs: enabled } }).queryClient

const mockIsAgentV2Enabled = vi.hoisted(() => vi.fn(() => true))
const mockIsAgentV2InChatflowEnabled = vi.hoisted(() => vi.fn(() => false))
const releaseGate = vi.hoisted(() => ({ enabled: true }))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return releaseGate.enabled
  },
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => mockIsAgentV2Enabled(),
  isAgentV2InChatflowEnabled: () => mockIsAgentV2InChatflowEnabled(),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `/docs${path}`,
}))

describe('useWorkflowNodeCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAgentV2Enabled.mockReturnValue(true)
    mockIsAgentV2InChatflowEnabled.mockReturnValue(false)
    releaseGate.enabled = true
  })

  it.each(['workflow', 'advanced-chat'] as const)(
    'offers the original Human Input candidate in %s when the release gate is off',
    (mode) => {
      releaseGate.enabled = false
      const { result, setCanvas } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
        queryClient: catalogQueryClient(),
        resource: { kind: 'app', appId: 'app-1', mode },
      })
      const candidate = () =>
        result.current.nodes.filter(
          (node) =>
            node.metaData.type === BlockEnum.HumanInput ||
            node.metaData.type === BlockEnum.HumanInputV2,
        )

      expect(candidate().map((node) => node.metaData.type)).toEqual([BlockEnum.HumanInput])
      expect(candidate()[0]?.defaultValue).toMatchObject({ delivery_methods: [], timeout: 3 })
      expect(candidate()[0]?.defaultValue).not.toHaveProperty('version')

      act(() => setCanvas({ nodes: [createNode({ data: { type: BlockEnum.HumanInput } })] }))
      expect(candidate().map((node) => node.metaData.type)).toEqual([BlockEnum.HumanInput])
      expect(result.current.nodesMap?.[BlockEnum.HumanInputV2]?.defaultValue).toMatchObject({
        type: BlockEnum.HumanInput,
        version: '2',
      })
    },
  )

  it('should include chat-specific nodes and make the start node undeletable in chat mode', () => {
    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'advanced-chat',
      },
    })

    expect(result.current.nodesMap?.[BlockEnum.Start]?.metaData.isUndeletable).toBe(true)
    expect(result.current.nodesMap?.[BlockEnum.Answer]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.End]).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.TriggerWebhook]).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.VariableAssigner]).toBe(
      result.current.nodesMap?.[BlockEnum.VariableAggregator],
    )
    expect(result.current.nodesMap?.[BlockEnum.Start]?.metaData.helpLinkUri).toContain(
      '/docs/use-dify/nodes/',
    )
  })

  it('should expose only legacy Agent in chat mode by default even when Agent v2 is enabled', () => {
    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'advanced-chat',
      },
    })
    const nodeTypes = result.current.nodes.map((node) => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.Agent)
    expect(nodeTypes).not.toContain(BlockEnum.AgentV2)
    expect(result.current.nodesMap?.[BlockEnum.Agent]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.AgentV2]).toBeDefined()
  })

  it('should expose Agent v2 in chat mode when the Chatflow gate is enabled', () => {
    mockIsAgentV2InChatflowEnabled.mockReturnValue(true)

    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'advanced-chat',
      },
    })
    const nodeTypes = result.current.nodes.map((node) => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.AgentV2)
    expect(nodeTypes).not.toContain(BlockEnum.Agent)
    expect(result.current.nodesMap?.[BlockEnum.AgentV2]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.Agent]).toBeDefined()
  })

  it('should expose only legacy Agent in chat mode when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)
    mockIsAgentV2InChatflowEnabled.mockReturnValue(true)

    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'advanced-chat',
      },
    })
    const nodeTypes = result.current.nodes.map((node) => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.Agent)
    expect(nodeTypes).not.toContain(BlockEnum.AgentV2)
    expect(result.current.nodesMap?.[BlockEnum.Agent]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.AgentV2]).toBeDefined()
  })

  it('should include workflow-specific trigger and end nodes outside chat mode', () => {
    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'workflow',
      },
    })

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
    expect(result.current.nodesMap?.[BlockEnum.HumanInput]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.HumanInputV2]?.defaultValue).toMatchObject({
      type: BlockEnum.HumanInput,
      version: '2',
      recipients_spec: [],
    })
  })

  it('exposes one v2-backed Human Input candidate while retaining legacy routing metadata', () => {
    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
    })
    const candidates = result.current.nodes.filter(
      (node) =>
        node.metaData.type === BlockEnum.HumanInput ||
        node.metaData.type === BlockEnum.HumanInputV2,
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.metaData).toMatchObject({
      type: BlockEnum.HumanInputV2,
      title: 'workflow.blocks.human-input',
    })
    expect(candidates[0]?.defaultValue).toMatchObject({
      type: BlockEnum.HumanInput,
      version: '2',
    })
    expect(result.current.nodesMap?.[BlockEnum.HumanInput]?.defaultValue).toHaveProperty(
      'delivery_methods',
    )
  })

  it.each([InputVarType.select, InputVarType.singleFile, InputVarType.multiFiles])(
    'keeps supported legacy %s fields on the v2 migration path',
    (type) => {
      const legacy = createNode({
        data: {
          type: BlockEnum.HumanInput,
          inputs: [createDefaultFormInputByType(type, 'decision')],
        },
      })
      const { result, setCanvas } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
        nodes: [legacy],
        queryClient: catalogQueryClient(),
      })
      const humanInputCandidates = () =>
        result.current.nodes.filter(
          (node) =>
            node.metaData.type === BlockEnum.HumanInput ||
            node.metaData.type === BlockEnum.HumanInputV2,
        )

      expect(humanInputCandidates().map((node) => node.metaData.type)).toEqual([
        BlockEnum.HumanInputV2,
      ])
      expect(humanInputCandidates()[0]?.defaultValue).toMatchObject({ version: '2' })

      act(() =>
        setCanvas({
          nodes: [
            createNode({
              ...legacy,
              data: {
                ...legacy.data,
                version: '2',
              },
            }),
          ],
        }),
      )

      expect(humanInputCandidates().map((node) => node.metaData.type)).toEqual([
        BlockEnum.HumanInputV2,
      ])
    },
  )

  it('should use explicit docs pages and skip nodes without generated docs pages', () => {
    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'workflow',
      },
    })

    expect(result.current.nodesMap?.[BlockEnum.End]?.metaData.helpLinkUri).toBe(
      '/docs/use-dify/nodes/output',
    )
    expect(
      result.current.nodesMap?.[BlockEnum.IterationStart]?.metaData.helpLinkUri,
    ).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.LoopStart]?.metaData.helpLinkUri).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.LoopEnd]?.metaData.helpLinkUri).toBeUndefined()
    expect(result.current.nodesMap?.[BlockEnum.Start]?.metaData.helpLinkUri).toBe(
      '/docs/use-dify/nodes/start',
    )
  })

  it('should hide legacy Agent from the node picker but retain its validator when Agent v2 is enabled', () => {
    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'workflow',
      },
    })
    const nodeTypes = result.current.nodes.map((node) => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.AgentV2)
    expect(nodeTypes).not.toContain(BlockEnum.Agent)
    expect(result.current.nodesMap?.[BlockEnum.AgentV2]?.checkValid).toEqual(expect.any(Function))
    expect(result.current.nodesMap?.[BlockEnum.Agent]?.checkValid).toEqual(expect.any(Function))
    expect(result.current.nodesMap?.[BlockEnum.AgentV2]?.metaData.helpLinkUri).toBe(
      '/docs/use-dify/nodes/agent#new-agent',
    )
  })

  it('should expose only legacy Agent while retaining Agent v2 metadata when Agent v2 is disabled', () => {
    mockIsAgentV2Enabled.mockReturnValue(false)

    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient(),
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: 'workflow',
      },
    })
    const nodeTypes = result.current.nodes.map((node) => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.Agent)
    expect(nodeTypes).not.toContain(BlockEnum.AgentV2)
    expect(result.current.nodesMap?.[BlockEnum.Agent]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.AgentV2]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.Agent]?.metaData.helpLinkUri).toBe(
      '/docs/use-dify/nodes/agent#classic-agent',
    )
  })

  it('should hide Knowledge Retrieval v2 when KnowledgeFS is disabled', () => {
    const { result } = renderWorkflowCanvasHook(() => useWorkflowNodeCatalog(), {
      queryClient: catalogQueryClient({ enabled: false }),
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    expect(result.current.nodesMap?.[BlockEnum.KnowledgeRetrieval]).toBeDefined()
    expect(result.current.nodesMap?.[BlockEnum.KnowledgeRetrievalV2]).toBeUndefined()
  })
})
