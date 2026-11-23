import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'

// The RBAC catalog includes IP policy permissions even on Enterprise.
export function isWorkspacePermissionVisible(key: string, deploymentEdition: DeploymentEdition) {
  return deploymentEdition !== 'ENTERPRISE' || !key.startsWith('ip_policy.')
}
