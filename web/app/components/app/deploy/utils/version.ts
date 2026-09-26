import type { WorkflowVersionNameSource } from '@/app/components/workflow/utils/version'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'

export type DeploymentVersion = {
  behind?: number
  description?: string
  id: string
  latest?: boolean
  name: string
  publishedAt?: number
  publishedBy?: string
  tags?: string[]
}

type DeploymentVersionSource = WorkflowVersionNameSource & {
  id: string
  created_at?: number
  created_by?: { name?: string | null } | null
  environments?: Array<{ name: string }>
  marked_comment?: string | null
}

export function toDeploymentVersion(
  version: DeploymentVersionSource,
  defaultName: string,
  latestWorkflowId?: string,
): DeploymentVersion {
  const deploymentVersion: DeploymentVersion = {
    description: version.marked_comment || undefined,
    id: version.id,
    name: getWorkflowVersionName(version, defaultName),
  }

  if (latestWorkflowId !== undefined) deploymentVersion.latest = version.id === latestWorkflowId
  if (version.created_at !== undefined) deploymentVersion.publishedAt = version.created_at * 1000
  if (version.created_by?.name) deploymentVersion.publishedBy = version.created_by.name
  if ('environments' in version)
    deploymentVersion.tags = version.environments?.map((environment) => environment.name) ?? []

  return deploymentVersion
}
