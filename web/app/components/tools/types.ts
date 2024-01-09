export enum LOC {
  tools = 'tools',
  app = 'app',
}

export type Collection = {
  name: string
  author: string
  description: {
    zh_Hans: string
    en_US: string
  }
  icon: string
  label: {
    zh_Hans: string
    en_US: string
  }
  type: string
  team_credentials: Record<string, any>
}
