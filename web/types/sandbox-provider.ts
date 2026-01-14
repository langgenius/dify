export type ConfigSchema = {
  name: string
  type: string
}

export type SandboxProvider = {
  provider_type: string
  label: string
  description: string
  icon: string
  is_system_configured: boolean
  is_tenant_configured: boolean
  is_active: boolean
  config: Record<string, string>
  config_schema: ConfigSchema[]
}
