export type DataSourceCredential = {
  credential: Record<string, any>
  type: string
  name: string
  id: string
}
export type DataSourceAuth = {
  author: string
  provider: string
  plugin_id: string
  plugin_unique_identifier: string
  icon: any
  name: string
  label: any
  description: any
  credential_schema?: any[]
  oauth_schema?: {
    client_schema?: any[]
    credentials_schema?: any[]
  }
  credentials_list: DataSourceCredential[]
}
