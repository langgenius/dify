'use client'

import type { ApiKeyValues } from '@/app/components/share/connections/api-key-dialog'
import type { RequiredConnection } from '@/app/components/share/connections/required-connections'
import type { RequiredConnectionService } from '@/app/components/share/connections/required-services'
import { useState } from 'react'
import RequiredConnectionSetup from '@/app/components/share/connections/required-connection-setup'
import RequiredConnections from '@/app/components/share/connections/required-connections'
import SignIn from '@/app/components/share/sign-in'
import ConfigureConnectionsDemo from './configure-connections-demo'

const demoConnections: readonly RequiredConnection[] = [
  { id: 'notion', name: 'Notion', iconClassName: 'i-custom-public-common-notion' },
  { id: 'gmail', name: 'Gmail', iconClassName: 'i-custom-public-common-gmail' },
  {
    id: 'youtube',
    name: 'YouTube',
    iconClassName: 'i-ri-youtube-fill text-util-colors-red-red-600',
  },
  { id: 'google-search', name: 'Google Search', iconClassName: 'i-custom-public-plugins-google' },
]

const initialServices: readonly RequiredConnectionService[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send follow-up emails',
    iconClassName: 'i-custom-public-common-gmail',
    availableConnections: [
      { id: 'gmail-evan', name: 'evan@gmail.com' },
      { id: 'gmail-alex', name: 'alex@gmail.com' },
    ],
    selectedConnectionId: 'gmail-evan',
    methods: ['oauth'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read customer notes',
    iconClassName: 'i-custom-public-common-notion',
    availableConnections: [],
    methods: ['oauth'],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Review lead activity',
    iconClassName: 'i-ri-youtube-fill text-util-colors-red-red-600',
    availableConnections: [],
    methods: ['oauth'],
  },
  {
    id: 'google-search',
    name: 'Google Search',
    description: 'Research prospects',
    readmeUrl:
      'https://github.com/langgenius/dify-official-plugins/blob/main/tools/google/README.md',
    iconClassName: 'i-custom-public-plugins-google',
    availableConnections: [],
    methods: ['oauth', 'api-key'],
  },
]

const demoAccountNames: Record<string, string> = {
  gmail: 'Demo Gmail account',
  notion: 'Demo Notion account',
  youtube: 'Demo YouTube account',
  'google-search': 'Demo Google account',
}

export default function ConnectionsDemo() {
  const [services, setServices] = useState(initialServices)

  const handleConnect = (
    serviceId: string,
    method: RequiredConnectionService['methods'][number],
    values?: ApiKeyValues,
  ) => {
    const connection: RequiredConnectionService['availableConnections'][number] = {
      id:
        method === 'api-key'
          ? `${serviceId}-api-key-${crypto.randomUUID()}`
          : `${serviceId}-${method}-demo`,
      name:
        method === 'api-key'
          ? (values?.name ?? 'Demo API Key')
          : (demoAccountNames[serviceId] ?? 'Demo OAuth account'),
      method,
      status: 'active',
    }
    setServices((currentServices) =>
      currentServices.map((service) => {
        if (service.id !== serviceId) return service
        return {
          ...service,
          availableConnections: service.availableConnections.some(
            (item) => item.id === connection.id,
          )
            ? service.availableConnections.map((item) =>
                item.id === connection.id ? connection : item,
              )
            : [...service.availableConnections, connection],
          selectedConnectionId: connection.id,
        }
      }),
    )
  }

  const handleConnectionChange = (serviceId: string, connectionId: string) => {
    setServices((currentServices) =>
      currentServices.map((service) =>
        service.id === serviceId ? { ...service, selectedConnectionId: connectionId } : service,
      ),
    )
  }

  const handleReconnect = (serviceId: string, connectionId: string, replacement?: ApiKeyValues) => {
    setServices((currentServices) =>
      currentServices.map((service) =>
        service.id === serviceId
          ? {
              ...service,
              availableConnections: service.availableConnections.map((connection) =>
                connection.id === connectionId
                  ? {
                      ...connection,
                      name: replacement?.name ?? connection.name,
                      status: 'active' as const,
                    }
                  : connection,
              ),
              selectedConnectionId: connectionId,
            }
          : service,
      ),
    )
  }

  const handleRemove = (serviceId: string, connectionId: string) => {
    setServices((currentServices) =>
      currentServices.map((service) => {
        if (service.id !== serviceId) return service
        const availableConnections = service.availableConnections.filter(
          (connection) => connection.id !== connectionId,
        )
        return {
          ...service,
          availableConnections,
          selectedConnectionId:
            service.selectedConnectionId === connectionId
              ? availableConnections.find(
                  (connection) => !connection.status || connection.status === 'active',
                )?.id
              : service.selectedConnectionId,
        }
      }),
    )
  }

  return (
    <main className="min-h-dvh bg-background-body p-6 sm:p-8">
      <div className="flex w-150 max-w-full flex-col gap-6">
        <RequiredConnections connections={demoConnections} />
        <hr className="w-full border-0 border-t-2 border-divider-deep" />
        <RequiredConnectionSetup
          services={services}
          onConnect={handleConnect}
          onConnectionChange={handleConnectionChange}
          onReconnect={handleReconnect}
          onReplace={handleReconnect}
          onRemove={handleRemove}
        />
        <hr className="w-full border-0 border-t-2 border-divider-deep" />
        <ConfigureConnectionsDemo />
        <hr className="w-full border-0 border-t-2 border-divider-deep" />
        <SignIn className="self-start" />
      </div>
    </main>
  )
}
