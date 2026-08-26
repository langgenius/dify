import type { GetVersionResponse } from '@dify/contracts/api/console/version/types.gen'
import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { LangGeniusVersionInfo } from './app-context-types'
import { initialLangGeniusVersionInfo, initialWorkspaceSummary } from './app-context-defaults'

const workspaceRoles = new Set<GetWorkspacesCurrentSummaryResponse['role']>([
  'owner',
  'admin',
  'editor',
  'dataset_operator',
  'normal',
])

export const emptyWorkspacePermissionKeys: string[] = []

export type WorkspaceRoleFlags = {
  isCurrentWorkspaceManager: boolean
  isCurrentWorkspaceOwner: boolean
  isCurrentWorkspaceEditor: boolean
  isCurrentWorkspaceDatasetOperator: boolean
}

export type ProfileMeta = {
  currentVersion: string | null
  currentEnv: string | null
}

function resolveWorkspaceRole(
  role: GetWorkspacesCurrentSummaryResponse['role'],
): GetWorkspacesCurrentSummaryResponse['role'] {
  if (workspaceRoles.has(role)) return role

  return initialWorkspaceSummary.role
}

export function normalizeCurrentWorkspaceSummary(
  workspace?: GetWorkspacesCurrentSummaryResponse,
): GetWorkspacesCurrentSummaryResponse {
  if (!workspace) return initialWorkspaceSummary

  return {
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    credits: workspace.credits,
    role: resolveWorkspaceRole(workspace.role),
  }
}

export function getWorkspaceRoleFlags(
  currentWorkspace: GetWorkspacesCurrentSummaryResponse,
): WorkspaceRoleFlags {
  return {
    isCurrentWorkspaceManager: ['owner', 'admin'].includes(currentWorkspace.role),
    isCurrentWorkspaceOwner: currentWorkspace.role === 'owner',
    isCurrentWorkspaceEditor: ['owner', 'admin', 'editor'].includes(currentWorkspace.role),
    isCurrentWorkspaceDatasetOperator: currentWorkspace.role === 'dataset_operator',
  }
}

export function getLangGeniusVersionInfo({
  meta,
  versionData,
}: {
  meta: ProfileMeta
  versionData?: GetVersionResponse
}): LangGeniusVersionInfo {
  if (!meta.currentVersion || !versionData) return initialLangGeniusVersionInfo

  return {
    ...versionData,
    current_version: meta.currentVersion,
    latest_version: versionData.version,
    current_env: meta.currentEnv || '',
  }
}
