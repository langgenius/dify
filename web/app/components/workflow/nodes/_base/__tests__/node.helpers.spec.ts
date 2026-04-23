import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import {
  getLoopIndexTextKey,
  getNodeStatusBorders,
  isContainerNode,
  isEntryWorkflowNode,
} from '../node.helpers'

describe('node helpers', () => {
  it('should derive node border states from running status and selection state', () => {
    expect(getNodeStatusBorders(NodeRunningStatus.Running, false, false).showRunningBorder).toBe(true)
    expect(getNodeStatusBorders(NodeRunningStatus.Succeeded, false, false).showSuccessBorder).toBe(true)
    expect(getNodeStatusBorders(NodeRunningStatus.Failed, false, false).showFailedBorder).toBe(true)
    expect(getNodeStatusBorders(NodeRunningStatus.Exception, false, false).showExceptionBorder).toBe(true)
    expect(getNodeStatusBorders(NodeRunningStatus.Succeeded, false, true).showSuccessBorder).toBe(false)
  })

  it('should expose the correct loop translation key per running status', () => {
    expect(getLoopIndexTextKey(NodeRunningStatus.Running)).toBe('nodes.loop.currentLoopCount')
    expect(getLoopIndexTextKey(NodeRunningStatus.Succeeded)).toBe('nodes.loop.totalLoopCount')
    expect(getLoopIndexTextKey(NodeRunningStatus.Failed)).toBe('nodes.loop.totalLoopCount')
    expect(getLoopIndexTextKey(NodeRunningStatus.Paused)).toBeUndefined()
  })

  it('should identify entry and container nodes', () => {
    expect(isEntryWorkflowNode(BlockEnum.Start)).toBe(true)
    expect(isEntryWorkflowNode(BlockEnum.TriggerWebhook)).toBe(true)
    expect(isEntryWorkflowNode(BlockEnum.Tool)).toBe(false)

    expect(isContainerNode(BlockEnum.Iteration)).toBe(true)
    expect(isContainerNode(BlockEnum.Loop)).toBe(true)
    expect(isContainerNode(BlockEnum.Tool)).toBe(false)
  })
})
