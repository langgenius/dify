import type { CredentialFormSchemaBase } from '../header/account-setting/model-provider-page/declarations'

export enum PluginType {
  plugin = 'plugin',
  model = 'model',
  extension = 'Extension',
}

export type Plugin = {
  'type': PluginType
  'org': string
  'name': string
  'latest_version': string
  'icon': string
  'label': {
    'en_US': string
    'zh_Hans': string
  }
  'brief': {
    'en_US': string
    'zh_Hans': string
  }
  // Repo readme.md content
  'introduction': string
  'repository': string
  'category': string
  'install_count': number
  'endpoint': {
    settings: CredentialFormSchemaBase[]
  }
}
