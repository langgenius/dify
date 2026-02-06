/**
 * GitHub Integration Types
 */

export type GitHubConnection = {
  id: string
  tenant_id: string
  user_id: string
  app_id: string | null
  repository_owner: string
  repository_name: string
  repository_full_name: string
  branch: string
  workflow_file_path: string
  token_expires_at: string | null
  webhook_id: string | null
  created_at: string
  updated_at: string
}

export type GitHubConnectionCreatePayload = {
  app_id?: string | null
  repository_owner: string
  repository_name: string
  branch?: string
  oauth_state?: string | null
}

export type GitHubConnectionUpdatePayload = {
  repository_owner?: string
  repository_name?: string
  branch?: string
  workflow_file_path?: string
}

export type GitHubRepository = {
  id: number
  name: string
  full_name: string
  private: boolean
  description: string | null
  default_branch: string
  [key: string]: unknown
}

export type GitHubBranch = {
  name: string
  commit: {
    sha: string
    url: string
  }
  protected: boolean
}
