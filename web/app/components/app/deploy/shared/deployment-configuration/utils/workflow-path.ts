import type { WorkflowPath } from '@dify/contracts/enterprise-app-deploy/types.gen'

export function workflowPathKey(path: WorkflowPath) {
  return JSON.stringify(path.workflows.map((workflow) => [workflow.app_id, workflow.workflow_id]))
}

export function uniqueWorkflowPaths(paths: WorkflowPath[]) {
  return [
    ...new Map(
      paths
        .filter((path) => path.workflows.length > 0)
        .map((path) => [workflowPathKey(path), path] as const),
    ).values(),
  ]
}
