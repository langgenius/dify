import { describe, expect, it } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  buildNodeSelectorAvailabilityContext,
  filterNodesForSelector,
  isNodeAvailableInSelector,
  NodeSelectorSandboxMode,
  NodeSelectorScene,
} from './node-availability'

type MockNode = {
  metaData: {
    type: BlockEnum
  }
}

describe('node-availability', () => {
  it('should hide command and file-upload when sandbox is disabled', () => {
    const mockNodes: MockNode[] = [
      { metaData: { type: BlockEnum.Start } },
      { metaData: { type: BlockEnum.Command } },
      { metaData: { type: BlockEnum.FileUpload } },
    ]

    const result = filterNodesForSelector(mockNodes, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Disabled,
    })
    const nodeTypes = result.map(node => node.metaData.type)

    expect(nodeTypes).toEqual([BlockEnum.Start])
  })

  it('should keep command and file-upload when sandbox is enabled', () => {
    const mockNodes: MockNode[] = [
      { metaData: { type: BlockEnum.Start } },
      { metaData: { type: BlockEnum.Command } },
      { metaData: { type: BlockEnum.FileUpload } },
    ]

    const result = filterNodesForSelector(mockNodes, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Enabled,
    })
    const nodeTypes = result.map(node => node.metaData.type)

    expect(nodeTypes).toEqual([BlockEnum.Start, BlockEnum.Command, BlockEnum.FileUpload])
  })

  it('should return original reference when no filtering is needed', () => {
    const mockNodes: MockNode[] = [
      { metaData: { type: BlockEnum.Start } },
      { metaData: { type: BlockEnum.End } },
    ]

    const result = filterNodesForSelector(mockNodes, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Disabled,
    })

    expect(result).toBe(mockNodes)
  })

  it('should mark command and file-upload as sandbox-only', () => {
    expect(isNodeAvailableInSelector(BlockEnum.Command, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Disabled,
    })).toBe(false)
    expect(isNodeAvailableInSelector(BlockEnum.FileUpload, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Disabled,
    })).toBe(false)
    expect(isNodeAvailableInSelector(BlockEnum.Start, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Disabled,
    })).toBe(true)
  })

  it('should hide agent when sandbox is enabled', () => {
    expect(isNodeAvailableInSelector(BlockEnum.Agent, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Enabled,
    })).toBe(false)
    expect(isNodeAvailableInSelector(BlockEnum.Agent, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Disabled,
    })).toBe(true)
  })

  it('should hide human-input in rag pipeline flow', () => {
    expect(isNodeAvailableInSelector(BlockEnum.HumanInput, {
      scene: NodeSelectorScene.RagPipeline,
      sandboxMode: NodeSelectorSandboxMode.Enabled,
    })).toBe(false)
    expect(isNodeAvailableInSelector(BlockEnum.HumanInput, {
      scene: NodeSelectorScene.RagPipeline,
      sandboxMode: NodeSelectorSandboxMode.Disabled,
    })).toBe(false)
    expect(isNodeAvailableInSelector(BlockEnum.HumanInput, {
      scene: NodeSelectorScene.Workflow,
      sandboxMode: NodeSelectorSandboxMode.Disabled,
    })).toBe(true)
  })

  it('should build unsupported sandbox mode for scenes that do not support sandbox', () => {
    const context = buildNodeSelectorAvailabilityContext({
      scene: NodeSelectorScene.RagPipeline,
      isSandboxRuntime: true,
      isSandboxFeatureEnabled: true,
    })

    expect(context.scene).toBe(NodeSelectorScene.RagPipeline)
    expect(context.sandboxMode).toBe(NodeSelectorSandboxMode.Unsupported)
  })

  it('should allow explicit scene sandbox support override', () => {
    const context = buildNodeSelectorAvailabilityContext({
      scene: NodeSelectorScene.RagPipeline,
      supportsSandbox: true,
      isSandboxRuntime: true,
      isSandboxFeatureEnabled: false,
    })

    expect(context.sandboxMode).toBe(NodeSelectorSandboxMode.Enabled)
  })

  it('should build enabled sandbox mode when runtime or feature enables sandbox', () => {
    const contextByRuntime = buildNodeSelectorAvailabilityContext({
      scene: NodeSelectorScene.Workflow,
      isSandboxRuntime: true,
      isSandboxFeatureEnabled: false,
    })
    const contextByFeature = buildNodeSelectorAvailabilityContext({
      scene: NodeSelectorScene.Workflow,
      isSandboxRuntime: false,
      isSandboxFeatureEnabled: true,
    })

    expect(contextByRuntime.sandboxMode).toBe(NodeSelectorSandboxMode.Enabled)
    expect(contextByFeature.sandboxMode).toBe(NodeSelectorSandboxMode.Enabled)
  })
})
