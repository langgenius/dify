import type { GetVersionResponse } from '@dify/contracts/api/console/version/types.gen'
import type { PostWorkspacesCurrentResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { LangGeniusVersionInfo } from './app-context-types'
import type { ICurrentWorkspace } from '@/models/common'
import { initialLangGeniusVersionInfo, initialWorkspaceInfo } from './app-context-defaults'

const workspaceRoles = new Set<ICurrentWorkspace['role']>([
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
  role: PostWorkspacesCurrentResponse['role'],
): ICurrentWorkspace['role'] {
  if (role && workspaceRoles.has(role as ICurrentWorkspace['role']))
    return role as ICurrentWorkspace['role']

  return initialWorkspaceInfo.role
}

export function normalizeCurrentWorkspace(
  workspace?: PostWorkspacesCurrentResponse,
): ICurrentWorkspace {
  if (!workspace) return initialWorkspaceInfo

  return {
    id: workspace.id,
    name: workspace.name ?? initialWorkspaceInfo.name,
    plan: workspace.plan ?? initialWorkspaceInfo.plan,
    status: workspace.status ?? initialWorkspaceInfo.status,
    created_at: workspace.created_at ?? initialWorkspaceInfo.created_at,
    role: resolveWorkspaceRole(workspace.role),
    providers: initialWorkspaceInfo.providers,
    trial_credits: workspace.trial_credits ?? initialWorkspaceInfo.trial_credits,
    trial_credits_used: workspace.trial_credits_used ?? initialWorkspaceInfo.trial_credits_used,
    trial_credits_exhausted_at:
      workspace.trial_credits_exhausted_at ?? initialWorkspaceInfo.trial_credits_exhausted_at,
    next_credit_reset_date:
      workspace.next_credit_reset_date ?? initialWorkspaceInfo.next_credit_reset_date,
    trial_end_reason: workspace.trial_end_reason ?? undefined,
    custom_config: workspace.custom_config
      ? {
          remove_webapp_brand: workspace.custom_config.remove_webapp_brand ?? undefined,
          replace_webapp_logo: workspace.custom_config.replace_webapp_logo ?? undefined,
        }
      : undefined,
  }
}

export function getWorkspaceRoleFlags(currentWorkspace: ICurrentWorkspace): WorkspaceRoleFlags {
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
