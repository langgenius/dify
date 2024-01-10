export enum LOC {
  tools = 'tools',
  app = 'app',
}

export enum CollectionType {
  all = 'all',
  builtIn = 'builtIn',
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
  id: string
  name: string
  description: string
}
