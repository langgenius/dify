import type { CredentialFormSchemaBase } from '../header/account-setting/model-provider-page/declarations'
import type { ToolCredential } from '@/app/components/tools/types'
import type { Locale } from '@/i18n'
import type { AgentFeature } from '@/app/components/workflow/nodes/agent/types'
export enum PluginType {
  tool = 'tool',
  model = 'model',
  extension = 'extension',
  agent = 'agent-strategy',
}

export enum PluginSource {
  marketplace = 'marketplace',
  github = 'github',
  local = 'package',
  debugging = 'remote',
}

export type PluginToolDeclaration = {
  identity: {
    author: string
    name: string
    description: Record<Locale, string>
    icon: string
    label: Record<Locale, string>
    tags: string[]
  }
  credentials_schema: ToolCredential[] // TODO
}

export type PluginEndpointDeclaration = {
  settings: ToolCredential[]
  endpoints: EndpointItem[]
}

export type EndpointItem = {
  path: string
  method: string
  hidden?: boolean
}

export type EndpointListItem = {
  id: string
  created_at: string
  updated_at: string
  settings: Record<string, any>
  tenant_id: string
  plugin_id: string
  expired_at: string
  declaration: PluginEndpointDeclaration
  name: string
  enabled: boolean
  url: string
  hook_id: string
}

export type PluginDeclarationMeta = {
  version: string
  minimum_dify_version?: string
}

// Plugin manifest
export type PluginDeclaration = {
  plugin_unique_identifier: string
  version: string
  author: string
  icon: string
  name: string
  category: PluginType
  label: Record<Locale, string>
  description: Record<Locale, string>
  created_at: string
  resource: any // useless in frontend
  plugins: any // useless in frontend
  verified: boolean
  endpoint: PluginEndpointDeclaration
  tool: PluginToolDeclaration
  model: any
  tags: string[]
  agent_strategy: any
  meta: PluginDeclarationMeta
}

export type PluginManifestInMarket = {
  plugin_unique_identifier: string
  name: string
  org: string
  icon: string
  label: Record<Locale, string>
  category: PluginType
  version: string // combine the other place to it
  latest_version: string
  brief: Record<Locale, string>
  introduction: string
  verified: boolean
  install_count: number
  badges: string[]
}

export type PluginDetail = {
  id: string
  created_at: string
  updated_at: string
  name: string
  plugin_id: string
  plugin_unique_identifier: string
  declaration: PluginDeclaration
  installation_id: string
  tenant_id: string
  endpoints_setups: number
  endpoints_active: number
  version: string
  latest_version: string
  latest_unique_identifier: string
  source: PluginSource
  meta?: MetaData
}

export type PluginInfoFromMarketPlace = {
  category: PluginType
  latest_package_identifier: string
  latest_version: string
}

export type Plugin = {
  type: 'plugin' | 'bundle' | 'model' | 'extension' | 'tool' | 'agent_strategy'
  org: string
  author?: string
  name: string
  plugin_id: string
  version: string
  latest_version: string
  latest_package_identifier: string
  icon: string
  verified: boolean
  label: Record<Locale, string>
  brief: Record<Locale, string>
  description: Record<Locale, string>
  // Repo readme.md content
  introduction: string
  repository: string
  category: PluginType
  install_count: number
  endpoint: {
    settings: CredentialFormSchemaBase[]
  }
  tags: { name: string }[]
  badges: string[]
}

export enum PermissionType {
  everyone = 'everyone',
  admin = 'admins',
  noOne = 'noone',
}

export type Permissions = {
  install_permission: PermissionType
  debug_permission: PermissionType
}

export type UpdateFromMarketPlacePayload = {
  category: PluginType
  originalPackageInfo: {
    id: string
    payload: PluginDeclaration
  },
  targetPackageInfo: {
    id: string
    version: string
  }
}

export type UpdateFromGitHubPayload = {
  originalPackageInfo: {
    id: string
    repo: string
    version: string
    package: string
    releases: GitHubRepoReleaseResponse[]
  }
}

export type UpdatePluginPayload = {
  type: PluginSource
  category: PluginType
  marketPlace?: UpdateFromMarketPlacePayload
  github?: UpdateFromGitHubPayload
}

export type UpdatePluginModalType = UpdatePluginPayload & {
  onCancel: () => void
  onSave: () => void
}

export enum InstallStepFromGitHub {
  setUrl = 'url',
  selectPackage = 'selecting',
  readyToInstall = 'readyToInstall',
  uploadFailed = 'uploadFailed',
  installed = 'installed',
  installFailed = 'failed',
}

export type InstallState = {
  step: InstallStepFromGitHub
  repoUrl: string
  selectedVersion: string
  selectedPackage: string
  releases: GitHubRepoReleaseResponse[]
}

export type GitHubUrlInfo = {
  isValid: boolean
  owner?: string
  repo?: string
}

// endpoint
export type EndpointOperationResponse = {
  result: 'success' | 'error'
}

export type EndpointsResponse = {
  endpoints: EndpointListItem[]
  has_more: boolean
  limit: number
  total: number
  page: number
}
export type UpdateEndpointRequest = {
  endpoint_id: string
  settings: Record<string, any>
  name: string
}

export enum InstallStep {
  uploading = 'uploading',
  uploadFailed = 'uploadFailed',
  readyToInstall = 'readyToInstall',
  installing = 'installing',
  installed = 'installed',
  installFailed = 'failed',
}

export type GitHubAsset = {
  id: number
  name: string
  browser_download_url: string
}

export type GitHubRepoReleaseResponse = {
  tag_name: string
  assets: GitHubAsset[]
}

export type InstallPackageResponse = {
  plugin_unique_identifier: string
  all_installed: boolean
  task_id: string
}

export type InstallStatusResponse = {
  success: boolean,
  isFromMarketPlace?: boolean
}

export type updatePackageResponse = {
  all_installed: boolean
  task_id: string
}

export type uploadGitHubResponse = {
  unique_identifier: string
  manifest: PluginDeclaration
}

export type DebugInfo = {
  key: string
  host: string
  port: number
}

export enum TaskStatus {
  running = 'running',
  success = 'success',
  failed = 'failed',
}

export type PluginStatus = {
  plugin_unique_identifier: string
  plugin_id: string
  status: TaskStatus
  message: string
  icon: string
  labels: Record<Locale, string>
  taskId: string
}

export type PluginTask = {
  id: string
  created_at: string
  updated_at: string
  status: string
  total_plugins: number
  completed_plugins: number
  plugins: PluginStatus[]
}

export type TaskStatusResponse = {
  task: PluginTask
}

export type PluginTasksResponse = {
  tasks: PluginTask[]
}

export type MetaData = {
  repo: string
  version: string
  package: string
}

export type InstalledPluginListResponse = {
  plugins: PluginDetail[]
}

export type InstalledLatestVersionResponse = {
  versions: {
    [plugin_id: string]: {
      unique_identifier: string
      version: string
    } | null
  }
}

export type UninstallPluginResponse = {
  success: boolean
}

export type PluginsFromMarketplaceResponse = {
  plugins: Plugin[]
  bundles?: Plugin[]
  total: number
}
export type PluginsFromMarketplaceByInfoResponse = {
  list: {
    plugin: Plugin
    version: {
      plugin_name: string
      plugin_org: string
      unique_identifier: string
    }
  }[]
}

export type GitHubItemAndMarketPlaceDependency = {
  type: 'github' | 'marketplace' | 'package'
  value: {
    repo?: string
    version?: string // from app DSL
    package?: string // from app DSL
    release?: string // from local package. same to the version
    packages?: string // from local package. same to the package
    github_plugin_unique_identifier?: string
    marketplace_plugin_unique_identifier?: string
    plugin_unique_identifier?: string
  }
}

export type PackageDependency = {
  type: 'github' | 'marketplace' | 'package'
  value: {
    unique_identifier: string
    manifest: PluginDeclaration
  }
}

export type Dependency = GitHubItemAndMarketPlaceDependency | PackageDependency

export type Version = {
  plugin_org: string
  plugin_name: string
  version: string
  file_name: string
  checksum: string
  created_at: string
  unique_identifier: string
}

export type VersionListResponse = {
  versions: Version[]
}

export type VersionInfo = {
  installedId: string, // use to uninstall
  installedVersion: string,
  uniqueIdentifier: string
}

export type VersionProps = {
  hasInstalled: boolean
  installedVersion?: string
  toInstallVersion: string
}

export type StrategyParamItem = {
  name: string
  label: Record<Locale, string>
  help: Record<Locale, string>
  placeholder: Record<Locale, string>
  type: string
  scope: string
  required: boolean
  default: any
  options: any[]
  template: {
    enabled: boolean
  },
  auto_generate: {
    type: string
  }
}

export type StrategyDetail = {
  identity: {
    author: string
    name: string
    icon: string
    label: Record<Locale, string>
    provider: string
  },
  parameters: StrategyParamItem[]
  description: Record<Locale, string>
  output_schema: Record<string, any>
  features: AgentFeature[]
}

export type StrategyDeclaration = {
  identity: {
    author: string
    name: string
    description: Record<Locale, string>
    icon: string
    label: Record<Locale, string>
    tags: string[]
  },
  plugin_id: string
  strategies: StrategyDetail[]
}

export type StrategyPluginDetail = {
  provider: string
  plugin_unique_identifier: string
  plugin_id: string
  declaration: StrategyDeclaration
}
