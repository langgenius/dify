'use client'

import type {
  ConnectionMethod,
  RequiredConnectionService,
} from '@/app/components/share/connections/required-services'
import { useState } from 'react'
import ConfigureConnections from '@/app/components/share/connections/configure-connections'

const initialServices: readonly RequiredConnectionService[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send follow-up emails',
    iconClassName: 'i-custom-public-common-gmail',
    availableConnections: [
      { id: 'gmail-evan', name: 'evan@dify.ai', method: 'oauth' },
      { id: 'gmail-alex', name: 'alex@dify.ai', method: 'oauth' },
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
    iconClassName: 'i-custom-public-plugins-google',
    availableConnections: [
      { id: 'google-search-personal', name: 'Personal key', method: 'api-key' },
      { id: 'google-search-work', name: 'Work key', method: 'api-key' },
    ],
    selectedConnectionId: 'google-search-personal',
    methods: ['oauth', 'api-key'],
  },
]

export default function ConfigureConnectionsDemo() {
  const [services, setServices] = useState(initialServices)

  const handleConnect = (serviceId: string, method: ConnectionMethod) => {
    const connection = {
      id: `${serviceId}-${method}-demo`,
      name: method === 'api-key' ? 'Demo API Key' : 'demo@dify.ai',
      method,
    }
    setServices((currentServices) =>
      currentServices.map((service) => {
        if (service.id !== serviceId) return service
        return {
          ...service,
          availableConnections: service.availableConnections.some(
            (item) => item.id === connection.id,
          )
            ? service.availableConnections
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

  return (
    <ConfigureConnections
      services={services}
      onConnect={handleConnect}
      onConnectionChange={handleConnectionChange}
      isResponding
      className="self-start"
    />
  )
}
