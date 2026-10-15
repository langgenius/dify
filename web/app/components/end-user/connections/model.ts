export type ConnectionProvider = {
  id: string
  name: string
  description: string
  iconClassName: string
}

export type LinkedApp = {
  id: string
  name: string
  href: string
}

export type EndUserConnection = {
  id: string
  name: string
  type: 'oauth' | 'api-key'
  apps: readonly LinkedApp[]
}
