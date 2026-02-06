import type { GitHubBranch, GitHubConnection, GitHubConnectionCreatePayload, GitHubConnectionUpdatePayload, GitHubRepository } from '@/types/github'
import { API_PREFIX } from '@/config'
import { del, get, patch, post } from './base'

/**
 * GitHub Service
 * Handles all GitHub integration API calls
 */

export const fetchGitHubConnections = ({ appId }: { appId?: string }): Promise<{ data: GitHubConnection[] }> => {
  const params: Record<string, string> = {}
  if (appId)
    params.app_id = appId
  return get<{ data: GitHubConnection[] }>('github/connections', { params })
}

export const fetchGitHubConnection = ({ connectionId }: { connectionId: string }): Promise<{ data: GitHubConnection }> => {
  return get<{ data: GitHubConnection }>(`github/connections/${connectionId}`)
}

export const createGitHubConnection = (payload: GitHubConnectionCreatePayload): Promise<{ data: GitHubConnection }> => {
  return post<{ data: GitHubConnection }>('github/connections', { body: payload })
}

export const updateGitHubConnection = ({
  connectionId,
  payload,
}: {
  connectionId: string
  payload: GitHubConnectionUpdatePayload
}): Promise<{ data: GitHubConnection }> => {
  return patch<{ data: GitHubConnection }>(`github/connections/${connectionId}`, { body: payload })
}

export const deleteGitHubConnection = ({ connectionId }: { connectionId: string }): Promise<{ result: string }> => {
  return del<{ result: string }>(`github/connections/${connectionId}`)
}

export const fetchGitHubRepositories = ({ connectionId }: { connectionId: string }): Promise<{ data: GitHubRepository[] }> => {
  return get<{ data: GitHubRepository[] }>(`github/connections/${connectionId}/repositories`)
}

export const fetchGitHubBranches = ({ connectionId }: { connectionId: string }): Promise<{ data: GitHubBranch[] }> => {
  return get<{ data: GitHubBranch[] }>(`github/connections/${connectionId}/branches`)
}

export const fetchGitHubRepositoriesFromOAuth = ({ oauthState }: { oauthState: string }): Promise<{ data: GitHubRepository[] }> => {
  return get<{ data: GitHubRepository[] }>('github/oauth/repositories', { params: { oauth_state: oauthState } })
}

/**
 * Get GitHub OAuth authorization URL
 * Note: This will redirect the browser, so it's typically used as a link href
 */
export const getGitHubOAuthUrl = ({ appId, redirectUri }: { appId?: string, redirectUri?: string }): string => {
  const params = new URLSearchParams()
  if (appId)
    params.append('app_id', appId)
  if (redirectUri)
    params.append('redirect_uri', redirectUri)
  const queryString = params.toString() ? `?${params.toString()}` : ''
  return `${API_PREFIX}/github/oauth/authorize${queryString}`
}

/**
 * Push workflow to GitHub
 */
export const pushWorkflowToGitHub = ({
  appId,
  workflowId,
  commitMessage,
  branch,
  includeSecret = false,
}: {
  appId: string
  workflowId?: string
  commitMessage?: string
  branch?: string
  includeSecret?: boolean
}): Promise<{ success: boolean, commit: { sha: string, message: string, url: string } }> => {
  return post<{ success: boolean, commit: { sha: string, message: string, url: string } }>('github/workflows/push', {
    body: {
      app_id: appId,
      workflow_id: workflowId,
      commit_message: commitMessage,
      branch,
      include_secret: includeSecret,
    },
  })
}

/**
 * Pull workflow from GitHub
 */
export const pullWorkflowFromGitHub = ({
  appId,
  workflowId,
  branch,
}: {
  appId: string
  workflowId?: string
  branch?: string
}): Promise<{ success: boolean, workflow: { id: string, version: string, updated_at: string } }> => {
  return post<{ success: boolean, workflow: { id: string, version: string, updated_at: string } }>('github/workflows/pull', {
    body: {
      app_id: appId,
      workflow_id: workflowId,
      branch,
    },
  })
}

/**
 * Get workflow commit history
 */
export const fetchWorkflowCommits = ({
  appId,
  branch,
  limit = 30,
}: {
  appId: string
  branch?: string
  limit?: number
}): Promise<{ commits: Array<{ sha: string, message: string, author: string, date: string, url: string }> }> => {
  const params: Record<string, string> = { app_id: appId }
  if (branch)
    params.branch = branch
  if (limit)
    params.limit = limit.toString()
  return get<{ commits: Array<{ sha: string, message: string, author: string, date: string, url: string }> }>('github/workflows/commits', { params })
}

/**
 * Create a new branch
 */
export const createGitHubBranch = ({
  appId,
  branchName,
  fromBranch = 'main',
}: {
  appId: string
  branchName: string
  fromBranch?: string
}): Promise<{ success: boolean, branch: { name: string, sha: string, url: string } }> => {
  return post<{ success: boolean, branch: { name: string, sha: string, url: string } }>('github/branches', {
    body: {
      app_id: appId,
      branch_name: branchName,
      from_branch: fromBranch,
    },
  })
}

/**
 * List branches for an app
 */
export const fetchGitHubBranchesByApp = ({ appId }: { appId: string }): Promise<{ data: Array<{ name: string, sha: string, protected: boolean }> }> => {
  return get<{ data: Array<{ name: string, sha: string, protected: boolean }> }>('github/branches/list', { params: { app_id: appId } })
}
