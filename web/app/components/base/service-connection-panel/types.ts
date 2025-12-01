import type { ReactNode } from 'react'

export type AuthType = 'oauth' | 'api_key'

export type ServiceConnectionStatus = 'pending' | 'connected' | 'error'

export type ServiceConnectionItem = {
  id: string
  name: string
  icon: ReactNode
  authType: AuthType
  status: ServiceConnectionStatus
  description?: string
}

export type ServiceConnectionPanelProps = {
  title?: string
  description?: string
  services: ServiceConnectionItem[]
  onConnect: (serviceId: string, authType: AuthType) => void
  onContinue?: () => void
  continueDisabled?: boolean
  continueText?: string
  className?: string
}
