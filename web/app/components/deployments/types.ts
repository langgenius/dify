export type EnvironmentMode = 'shared' | 'isolated'
export type EnvironmentBackend = 'k8s' | 'host'
export type EnvironmentHealth = 'ready' | 'degraded'

export type DeployStatus = 'ready' | 'deploying' | 'deploy_failed'

export type AppMode = 'chat' | 'agent-chat' | 'workflow' | 'completion' | 'advanced-chat'

export type AccessMethod = 'api' | 'runAccess'

export type AccessPermissionKind = 'organization' | 'specific' | 'external' | 'anyone'

export type EnvAccessPermission = {
  environmentId: string
  kind: AccessPermissionKind
  memberIds?: string[]
  groupIds?: string[]
}

export type Member = {
  id: string
  name: string
  email: string
}

export type MemberGroup = {
  id: string
  name: string
  memberCount: number
  description?: string
}

export type Environment = {
  id: string
  name: string
  namespace: string
  description?: string
  mode: EnvironmentMode
  backend: EnvironmentBackend
  health: EnvironmentHealth
  createdAt: string
}

export type Credential = {
  id: string
  name: string
  provider: string
  kind: 'model' | 'plugin'
  scope: string
  validated: boolean
}

export type AppInfo = {
  id: string
  name: string
  mode: AppMode
  iconType?: 'emoji' | 'image'
  icon?: string
  iconBackground?: string
  iconUrl?: string | null
  description?: string
}

export type Release = {
  id: string
  appId: string
  gateCommitId: string
  operator: string
  createdAt: string
  description?: string
  yaml: string
}

export type CredentialBinding = {
  provider: string
  kind: 'model' | 'plugin'
  credentialId?: string
}

export type EnvVariable = {
  key: string
  value: string
  type: 'string' | 'secret'
}

export type Deployment = {
  id: string
  instanceId: string
  environmentId: string
  activeReleaseId: string
  targetReleaseId?: string
  failedReleaseId?: string
  status: DeployStatus
  replicas?: number
  errorMessage?: string
  runtimeNote?: string
  credentials: CredentialBinding[]
  envVariables: EnvVariable[]
  createdAt: string
}

export type Instance = {
  id: string
  appId: string
  bindingProfileId?: string | undefined
  name: string
  description?: string
  createdAt: string
}

export type ApiKey = {
  id: string
  instanceId: string
  environmentId: string
  label: string
  value: string
  createdAt: string
}

export type InstanceAccess = {
  instanceId: string
  enabled: Record<AccessMethod, boolean>
  webappUrl?: string
  mcpUrl?: string
  envPermissions: EnvAccessPermission[]
}
