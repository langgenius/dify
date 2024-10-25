import type { CredentialFormSchemaBase } from '../header/account-setting/model-provider-page/declarations'
import type { ToolCredential } from '@/app/components/tools/types'
import type { Locale } from '@/i18n'

export enum PluginType {
  tool = 'tool',
  model = 'model',
  extension = 'extension',
}

export enum PluginSource {
  marketplace = 'marketplace',
  github = 'github',
  local = 'package',
  debugging = 'remote',
}

export interface PluginToolDeclaration {
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

export interface PluginEndpointDeclaration {
  settings: ToolCredential[]
  endpoints: EndpointItem[]
}

export interface EndpointItem {
  path: string
  method: string
}

export interface EndpointListItem {
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

// Plugin manifest
export interface PluginDeclaration {
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
  model: any // TODO
}

export interface PluginDetail {
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
  source: PluginSource
  meta?: any
}

export interface Plugin {
  type: PluginType
  org: string
  name: string
  version: string
  latest_version: string
  icon: string
  verified: boolean
  label: Record<Locale, string>
  brief: Record<Locale, string>
  // Repo readme.md content
  introduction: string
  repository: string
  category: string
  install_count: number
  endpoint: {
    settings: CredentialFormSchemaBase[]
  }
}

export enum PermissionType {
  everyone = 'everyone',
  admin = 'admin',
  noOne = 'noOne',
}

export interface Permissions {
  canManagement: PermissionType
  canDebugger: PermissionType
}

export enum InstallStepFromGitHub {
  setUrl = 'url',
  setVersion = 'version',
  setPackage = 'package',
  installed = 'installed',
}

export interface InstallState {
  step: InstallStepFromGitHub
  repoUrl: string
  selectedVersion: string
  selectedPackage: string
  releases: GitHubRepoReleaseResponse[]
}

export interface GitHubUrlInfo {
  isValid: boolean
  owner?: string
  repo?: string
}

// endpoint
export interface CreateEndpointRequest {
  plugin_unique_identifier: string
  settings: Record<string, any>
  name: string
}
export interface EndpointOperationResponse {
  result: 'success' | 'error'
}
export interface EndpointsRequest {
  limit: number
  page: number
  plugin_id: string
}
export interface EndpointsResponse {
  endpoints: EndpointListItem[]
  has_more: boolean
  limit: number
  total: number
  page: number
}
export interface UpdateEndpointRequest {
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

export interface GitHubAsset {
  id: number
  name: string
  browser_download_url: string
}

export interface GitHubRepoReleaseResponse {
  tag_name: string
  assets: GitHubAsset[]
}

export interface InstallPackageResponse {
  plugin_unique_identifier: string
  all_installed: boolean
  task_id: string
}

export interface DebugInfo {
  key: string
  host: string
  port: number
}

export enum TaskStatus {
  running = 'running',
  success = 'success',
  failed = 'failed',
}

export interface PluginStatus {
  plugin_unique_identifier: string
  plugin_id: string
  status: TaskStatus
  message: string
}

export interface TaskStatusResponse {
  id: string
  created_at: string
  updated_at: string
  status: string
  total_plugins: number
  completed_plugins: number
  plugins: PluginStatus[]
}
