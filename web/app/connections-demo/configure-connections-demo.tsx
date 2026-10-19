'use client'

import type { ApiKeyValues } from '@/app/components/share/connections/api-key-dialog'
import type {
  ConnectionMethod,
  RequiredConnectionService,
} from '@/app/components/share/connections/required-services'
import { createDialogHandle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import ConfigureConnectionsButton from '@/app/components/share/connections/configure-connections-button'
import ConfigureConnectionsDialog from '@/app/components/share/connections/configure-connections-dialog'
import ManageConnectionButton from '@/app/components/share/connections/manage-connection-button'

const initialServices: readonly RequiredConnectionService[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send follow-up emails',
    iconClassName: 'i-custom-public-common-gmail',
    availableConnections: [
      { id: 'gmail-evan', name: 'evan@dify.ai', method: 'oauth', status: 'expired' },
      { id: 'gmail-alex', name: 'alex@example.com', method: 'oauth', status: 'expired' },
      { id: 'gmail-sam', name: 'sam@dify.ai', method: 'oauth', status: 'active' },
    ],
    selectedConnectionId: 'gmail-evan',
    methods: ['oauth'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read customer notes',
    iconClassName: 'i-custom-public-common-notion',
    availableConnections: [
      { id: 'notion-evan', name: 'evan@dify.ai', method: 'oauth' },
      { id: 'notion-alex', name: 'alex@dify.ai', method: 'oauth' },
    ],
    selectedConnectionId: 'notion-evan',
    methods: ['oauth'],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Review lead activity',
    iconClassName: 'i-ri-youtube-fill text-util-colors-red-red-600',
    availableConnections: [
      { id: 'youtube-evan', name: 'evan@dify.ai', method: 'oauth' },
      { id: 'youtube-alex', name: 'alex@dify.ai', method: 'oauth' },
    ],
    selectedConnectionId: 'youtube-evan',
    methods: ['oauth'],
  },
  {
    id: 'google-search',
    name: 'Google Search',
    description: 'Research prospects',
    readmeUrl:
      'https://github.com/langgenius/dify-official-plugins/blob/main/tools/google/README.md',
    iconClassName: 'i-custom-public-plugins-google',
    availableConnections: [
      { id: 'google-search-personal', name: 'Personal key', method: 'api-key', status: 'invalid' },
      { id: 'google-search-work', name: 'Work key', method: 'api-key', status: 'invalid' },
      { id: 'google-search-backup', name: 'Backup key', method: 'api-key', status: 'active' },
    ],
    selectedConnectionId: 'google-search-personal',
    methods: ['oauth', 'api-key'],
  },
]

export default function ConfigureConnectionsDemo() {
  const [services, setServices] = useState(initialServices)
  const [dialogHandle] = useState(() => createDialogHandle())

  const handleConnect = (serviceId: string, method: ConnectionMethod, values?: ApiKeyValues) => {
    const connection: RequiredConnectionService['availableConnections'][number] = {
      id:
        method === 'api-key'
          ? `${serviceId}-api-key-${crypto.randomUUID()}`
          : `${serviceId}-${method}-demo`,
      name: method === 'api-key' ? (values?.name ?? 'Demo API Key') : 'demo@dify.ai',
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

  const handleRestoreConnection = (
    serviceId: string,
    connectionId: string,
    replacement?: ApiKeyValues,
  ) => {
    setServices((currentServices) =>
      currentServices.map((service) => {
        if (service.id !== serviceId) return service
        return {
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
      }),
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
                  (connection) => connection.status === undefined || connection.status === 'active',
                )?.id
              : service.selectedConnectionId,
        }
      }),
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <DialogTrigger
          handle={dialogHandle}
          render={<ConfigureConnectionsButton services={services} />}
        />
        <DialogTrigger handle={dialogHandle} render={<ManageConnectionButton />} />
      </div>
      <ConfigureConnectionsDialog
        handle={dialogHandle}
        services={services}
        onConnect={handleConnect}
        onConnectionChange={handleConnectionChange}
        onReconnect={handleRestoreConnection}
        onReplace={handleRestoreConnection}
        onRemove={handleRemove}
      />
    </>
  )
}
