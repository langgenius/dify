import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import { useAvailableNodesMetaData } from './use-available-nodes-meta-data'

let mockSandboxEnabled = false
let mockRuntimeType: 'sandboxed' | 'classic' = 'classic'

function createNodeDefault(type: BlockEnum) {
  return {
    metaData: { type },
    defaultValue: { type },
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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
    createNodeDefault(BlockEnum.Agent),
    createNodeDefault(BlockEnum.Command),
    createNodeDefault(BlockEnum.FileUpload),
    createNodeDefault(BlockEnum.HumanInput),
    createNodeDefault(BlockEnum.VariableAggregator),
  ],
}))

describe('sub-graph/useAvailableNodesMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSandboxEnabled = false
    mockRuntimeType = 'classic'
  })

  it('should hide sandbox-only nodes in app flow when sandbox is disabled', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData(FlowType.appFlow))
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)

    expect(nodeTypes).not.toContain(BlockEnum.Command)
    expect(nodeTypes).not.toContain(BlockEnum.FileUpload)
    expect(nodeTypes).toContain(BlockEnum.Agent)
    expect(nodeTypes).toContain(BlockEnum.HumanInput)
  })

  it('should show sandbox-only nodes in app flow when sandbox feature is enabled', () => {
    mockSandboxEnabled = true

    const { result } = renderHook(() => useAvailableNodesMetaData(FlowType.appFlow))
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.Command)
    expect(nodeTypes).toContain(BlockEnum.FileUpload)
    expect(nodeTypes).not.toContain(BlockEnum.Agent)
    expect(nodeTypes).toContain(BlockEnum.HumanInput)
  })

  it('should show sandbox-only nodes in app flow when runtime type is sandboxed', () => {
    mockRuntimeType = 'sandboxed'

    const { result } = renderHook(() => useAvailableNodesMetaData(FlowType.appFlow))
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)

    expect(nodeTypes).toContain(BlockEnum.Command)
    expect(nodeTypes).toContain(BlockEnum.FileUpload)
    expect(nodeTypes).not.toContain(BlockEnum.Agent)
  })

  it('should ignore sandbox flags in rag pipeline flow', () => {
    mockSandboxEnabled = true
    mockRuntimeType = 'sandboxed'

    const { result } = renderHook(() => useAvailableNodesMetaData(FlowType.ragPipeline))
    const nodeTypes = result.current.nodes.map(node => node.metaData.type)

    expect(nodeTypes).not.toContain(BlockEnum.Command)
    expect(nodeTypes).not.toContain(BlockEnum.FileUpload)
    expect(nodeTypes).toContain(BlockEnum.Agent)
    expect(nodeTypes).not.toContain(BlockEnum.HumanInput)
  })

  it('should map variable assigner to variable aggregator metadata', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData(FlowType.appFlow))

    expect(result.current.nodesMap[BlockEnum.VariableAggregator]).toBeDefined()
    expect(result.current.nodesMap[BlockEnum.VariableAssigner]).toBe(result.current.nodesMap[BlockEnum.VariableAggregator])
  })
})
