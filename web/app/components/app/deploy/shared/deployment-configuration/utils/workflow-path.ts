import type { WorkflowPath } from '@dify/contracts/enterprise-app-deploy/types.gen'

export function workflowPathKey(path: WorkflowPath) {
  return JSON.stringify(path.workflows.map((workflow) => [workflow.app_id, workflow.workflow_id]))
}
