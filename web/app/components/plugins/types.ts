import type { CredentialFormSchemaBase } from '../header/account-setting/model-provider-page/declarations'
import type { Locale } from '@/i18n'

export enum PluginType {
  tool = 'tool',
  model = 'model',
  extension = 'extension',
}

export type Plugin = {
  'type': PluginType
  'org': string
  'name': string
  'version': string
  'latest_version': string
  'icon': string
  'label': Record<Locale, string>
  'brief': Record<Locale, string>
  // Repo readme.md content
  'introduction': string
  'repository': string
  'category': string
  'install_count': number
  'endpoint': {
    settings: CredentialFormSchemaBase[]
  }
}

export enum PermissionType {
  everyone = 'everyone',
  admin = 'admin',
  noOne = 'noOne',
}

export type Permissions = {
  canInstall: PermissionType
  canDebugger: PermissionType
}
