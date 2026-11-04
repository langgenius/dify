export const DSLImportMode = {
  YAML_CONTENT: 'yaml-content',
  YAML_URL: 'yaml-url',
} as const
export type DSLImportMode = (typeof DSLImportMode)[keyof typeof DSLImportMode]

export const DSLImportStatus = {
  COMPLETED: 'completed',
  COMPLETED_WITH_WARNINGS: 'completed-with-warnings',
  PENDING: 'pending',
  FAILED: 'failed',
} as const
export type DSLImportStatus = (typeof DSLImportStatus)[keyof typeof DSLImportStatus]

export type WorkflowOnlineUser = {
  user_id?: string
  username?: string
  avatar?: string | null
  sid?: string
}

export type WorkflowOnlineUsersResponse = {
  data:
    | Record<string, WorkflowOnlineUser[]>
    | Array<{
        app_id: string
        users: WorkflowOnlineUser[]
      }>
}
