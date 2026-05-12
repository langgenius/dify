import { NodeRunningStatus } from '../../types'
import { getEdgeColor } from '../edge'

describe('getEdgeColor', () => {
  it('should return success color when status is Succeeded', () => {
    expect(getEdgeColor(NodeRunningStatus.Succeeded)).toBe('var(--color-workflow-link-line-success-handle)')
  })

  it('should return error color when status is Failed', () => {
    expect(getEdgeColor(NodeRunningStatus.Failed)).toBe('var(--color-workflow-link-line-error-handle)')
  })

  it('should return failure color when status is Exception', () => {
    expect(getEdgeColor(NodeRunningStatus.Exception)).toBe('var(--color-workflow-link-line-failure-handle)')
  })

  it('should return default running color when status is Running and not fail branch', () => {
    expect(getEdgeColor(NodeRunningStatus.Running)).toBe('var(--color-workflow-link-line-handle)')
  })

  it('should return failure color when status is Running and is fail branch', () => {
    expect(getEdgeColor(NodeRunningStatus.Running, true)).toBe('var(--color-workflow-link-line-failure-handle)')
  })

  it('should return normal color when status is undefined', () => {
    expect(getEdgeColor()).toBe('var(--color-workflow-link-line-normal)')
  })

  it('should return normal color for other statuses', () => {
    expect(getEdgeColor(NodeRunningStatus.Waiting)).toBe('var(--color-workflow-link-line-normal)')
    expect(getEdgeColor(NodeRunningStatus.NotStart)).toBe('var(--color-workflow-link-line-normal)')
  })
})
