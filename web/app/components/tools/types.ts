export enum LOC {
  tools = 'tools',
  app = 'app',
}

export enum authType {
  none = 'none',
  apiKey = 'api_key',
}

export type Credential = {
  'auth_type': authType
  'api_key_header'?: string
  'api_key_value'?: string
}

export enum CollectionType {
  all = 'all',
  builtIn = 'builtin',
  custom = 'api',
}

export type Collection = {
  name: string
  author: string
  description: {
    zh_Hans: string
    en_US: string
  }
  icon: string | {
    background: string
    content: string
  }
  label: {
    zh_Hans: string
    en_US: string
  }
  type: CollectionType
  team_credentials: Record<string, any>
  is_team_authorization: boolean
}

export type Tool = {
  name: string
  label: {
    zh_Hans: string
    en_US: string
  }
  description: {
    zh_Hans: string
    en_US: string
  }
}
