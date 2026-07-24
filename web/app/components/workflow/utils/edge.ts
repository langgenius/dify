import {
  NodeRunningStatus,
} from '../types'

export const getEdgeColor = (nodeRunningStatus?: NodeRunningStatus, isFailBranch?: boolean) => {
  if (nodeRunningStatus === NodeRunningStatus.Succeeded)
    return 'var(--color-workflow-link-line-success-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Failed)
    return 'var(--color-workflow-link-line-error-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Exception)
    return 'var(--color-workflow-link-line-failure-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Running) {
    if (isFailBranch)
      return 'var(--color-workflow-link-line-failure-handle)'

    return 'var(--color-workflow-link-line-handle)'
  }

  return 'var(--color-workflow-link-line-normal)'
}
