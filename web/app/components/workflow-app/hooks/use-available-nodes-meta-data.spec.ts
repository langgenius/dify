import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableNodesMetaData } from './use-available-nodes-meta-data'

let mockIsChatMode = false
let mockSandboxEnabled = false
let mockRuntimeType: 'sandboxed' | 'classic' = 'classic'

function createNodeDefault(type: BlockEnum, helpLinkUri?: string) {
  return {
    metaData: {
      type,
      ...(helpLinkUri ? { helpLinkUri } : {}),
    },
    defaultValue: { type },
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('./use-is-chat-mode', () => ({
  useIsChatMode: () => mockIsChatMode,
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: { features: { sandbox: { enabled: boolean } } }) => unknown) => selector({
    features: {
      sandbox: {
        enabled: mockSandboxEnabled,
      },
    },
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { runtime_type: 'sandboxed' | 'classic' } }) => unknown) => selector({
    appDetail: {
      runtime_type: mockRuntimeType,
    },
  }),
}))

vi.mock('@/app/components/workflow/constants/node', () => ({
  WORKFLOW_COMMON_NODES: [
    createNodeDefault(BlockEnum.LLM, 'llm-help'),
    createNodeDefault(BlockEnum.Agent),
    createNodeDefault(BlockEnum.Command),
    createNodeDefault(BlockEnum.FileUpload),
    createNodeDefault(BlockEnum.VariableAggregator),
  ],
}))

vi.mock('@/app/components/workflow/nodes/start/default', () => ({
  default: createNodeDefault(BlockEnum.Start),
}))

vi.mock('@/app/components/workflow/nodes/end/default', () => ({
  default: createNodeDefault(BlockEnum.End),
}))

vi.mock('@/app/components/workflow/nodes/answer/default', () => ({
  default: createNodeDefault(BlockEnum.Answer),
}))

vi.mock('@/app/components/workflow/nodes/trigger-webhook/default', () => ({
  default: createNodeDefault(BlockEnum.TriggerWebhook),
}))

vi.mock('@/app/components/workflow/nodes/trigger-schedule/default', () => ({
  default: createNodeDefault(BlockEnum.TriggerSchedule),
}))

vi.mock('@/app/components/workflow/nodes/trigger-plugin/default', () => ({
  default: createNodeDefault(BlockEnum.TriggerPlugin),
}))

describe('workflow-app/useAvailableNodesMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsChatMode = false
    mockSandboxEnabled = false
    mockRuntimeType = 'classic'
  })

  it('should include workflow-only nodes when chat mode is disabled', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)
    const startNode = result.current.nodes.find(node => node.metaData.type === BlockEnum.Start)

    expect(nodeTypes).toContain(BlockEnum.End)
    expect(nodeTypes).toContain(BlockEnum.TriggerWebhook)
    expect(nodeTypes).toContain(BlockEnum.TriggerSchedule)
    expect(nodeTypes).toContain(BlockEnum.TriggerPlugin)
    expect(nodeTypes).not.toContain(BlockEnum.Answer)
    expect(startNode?.metaData.isUndeletable).toBe(false)
  })

  it('should include chatflow-only nodes when chat mode is enabled', () => {
    mockIsChatMode = true

    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)
    const startNode = result.current.nodes.find(node => node.metaData.type === BlockEnum.Start)

    expect(nodeTypes).toContain(BlockEnum.Answer)
    expect(nodeTypes).not.toContain(BlockEnum.End)
    expect(nodeTypes).not.toContain(BlockEnum.TriggerWebhook)
    expect(nodeTypes).not.toContain(BlockEnum.TriggerSchedule)
    expect(nodeTypes).not.toContain(BlockEnum.TriggerPlugin)
    expect(startNode?.metaData.isUndeletable).toBe(true)
  })

  it('should hide sandbox-only nodes and keep agent when sandbox is disabled', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)
    const llmNode = result.current.nodesMap[BlockEnum.LLM]

    expect(nodeTypes).not.toContain(BlockEnum.Command)
    expect(nodeTypes).not.toContain(BlockEnum.FileUpload)
    expect(nodeTypes).toContain(BlockEnum.Agent)
    expect(llmNode.metaData.title).toBe('blocks.llm')
    expect(llmNode.metaData.iconType).toBeUndefined()
  })

  it('should show sandbox-only nodes and hide agent when sandbox feature is enabled', () => {
    mockSandboxEnabled = true

    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)
    const llmNode = result.current.nodesMap[BlockEnum.LLM]
    const fileUploadNode = result.current.nodesMap[BlockEnum.FileUpload]

    expect(nodeTypes).toContain(BlockEnum.Command)
    expect(nodeTypes).toContain(BlockEnum.FileUpload)
    expect(nodeTypes).not.toContain(BlockEnum.Agent)
    expect(llmNode.metaData.title).toBe('blocks.agent')
    expect(llmNode.metaData.iconType).toBe(BlockEnum.Agent)
    expect(llmNode.defaultValue._iconTypeOverride).toBe(BlockEnum.Agent)
    expect(fileUploadNode.metaData.helpLinkUri).toBe('https://docs.dify.ai/use-dify/nodes/upload-file-to-sandbox')
  })

  it('should enable sandbox behavior when runtime type is sandboxed', () => {
    mockRuntimeType = 'sandboxed'

    const { result } = renderHook(() => useAvailableNodesMetaData())
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.Command)
    expect(nodeTypes).toContain(BlockEnum.FileUpload)
    expect(nodeTypes).not.toContain(BlockEnum.Agent)
  })

  it('should map variable assigner to variable aggregator metadata', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())

    expect(result.current.nodesMap[BlockEnum.VariableAggregator]).toBeDefined()
    expect(result.current.nodesMap[BlockEnum.VariableAssigner]).toBe(result.current.nodesMap[BlockEnum.VariableAggregator])
  })
})
