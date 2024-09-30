export enum PluginType {
  plugin = 'plugin',
  model = 'model',
  extension = 'Extension',
}

export type Endpoint = {
  'api_key': {
    'default': null
    'helper': null
    'label': {
      'en_US': string
      'zh_Hans': string
    }
    'name': ''
    'options': null
    'placeholder': {
      'en_US': string
      'zh_Hans': string
    }
    'required': true
    'scope': null
    'type': string
    'url': null
  }
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
  'endpoint': Endpoint
}
