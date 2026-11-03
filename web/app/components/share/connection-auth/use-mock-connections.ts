'use client'

import type { ComponentProps } from 'react'
import type { ApiKeyValues } from '../connections/api-key-form'
import type RequiredServices from '../connections/required-services'
import type { RequiredConnectionService } from '../connections/required-services'
import { ORPCError } from '@orpc/client'
import { useState } from 'react'
import { getServiceConnectionStatus } from '../connections/connection-status'
import { createMockServices, mockRequest } from './mock-data'

type Actions = Required<
  Pick<
    ComponentProps<typeof RequiredServices>,
    'onConnect' | 'onConnectionChange' | 'onReconnect' | 'onReplace' | 'onRemove'
  >
>

function validateMockKey(values?: ApiKeyValues) {
  if (
    typeof values?.credentials.api_key !== 'string' ||
    !values.credentials.api_key.trim().startsWith('sk')
  )
    throw new ORPCError('connection_credentials_invalid', { status: 400 })
}

export default function useMockConnections() {
  const [services, setServices] = useState(createMockServices)
  const updateService = (
    serviceId: string,
    update: (service: RequiredConnectionService) => RequiredConnectionService,
  ) => {
    setServices((current) =>
      current.map((service) => (service.id === serviceId ? update(service) : service)),
    )
  }

  const onConnect: Actions['onConnect'] = (serviceId, method, values) => {
    if (method === 'api-key') validateMockKey(values)
    const id = crypto.randomUUID()
    updateService(serviceId, (service) => {
      const accountCount = service.availableConnections.filter(
        (connection) => connection.method === 'oauth',
      ).length
      const name =
        method === 'api-key'
          ? values?.name.trim() || 'API Key'
          : accountCount === 0
            ? mockRequest.accountEmail
            : mockRequest.accountEmail.replace('@', `+${accountCount + 1}@`)
      return {
        ...service,
        availableConnections: [
          ...service.availableConnections,
          { id, name, method, status: 'active' },
        ],
        selectedConnectionId: id,
      }
    })
  }

  const onConnectionChange: Actions['onConnectionChange'] = (serviceId, connectionId) => {
    updateService(serviceId, (service) => ({ ...service, selectedConnectionId: connectionId }))
  }

  const onReconnect: Actions['onReconnect'] = (serviceId, connectionId) => {
    updateService(serviceId, (service) => ({
      ...service,
      availableConnections: service.availableConnections.map((connection) =>
        connection.id === connectionId ? { ...connection, status: 'active' } : connection,
      ),
    }))
  }

  const onReplace: Actions['onReplace'] = (serviceId, connectionId, values) => {
    validateMockKey(values)
    updateService(serviceId, (service) => ({
      ...service,
      availableConnections: service.availableConnections.map((connection) =>
        connection.id === connectionId
          ? { ...connection, name: values.name.trim() || 'API Key', status: 'active' }
          : connection,
      ),
    }))
  }

  const onRemove: Actions['onRemove'] = (serviceId, connectionId) => {
    updateService(serviceId, (service) => ({
      ...service,
      availableConnections: service.availableConnections.filter(
        (connection) => connection.id !== connectionId,
      ),
      selectedConnectionId:
        service.selectedConnectionId === connectionId ? undefined : service.selectedConnectionId,
    }))
  }

  const connectedCount = services.filter((service) => {
    const selected = service.availableConnections.find(
      (connection) => connection.id === service.selectedConnectionId,
    )
    return getServiceConnectionStatus(service, selected) === 'connected'
  }).length

  return {
    services,
    connectedCount,
    ready: services.length > 0 && connectedCount === services.length,
    onConnect,
    onConnectionChange,
    onReconnect,
    onReplace,
    onRemove,
  }
}
