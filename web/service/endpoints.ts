import type { EndpointsResponse } from '@/app/components/plugins/types'
import { get, post } from './base'

export const fetchEndpointList = (pluginID: string) => {
  return get<EndpointsResponse>('/workspaces/current/endpoints/list/plugin', {
    params: {
      plugin_id: pluginID,
      page: 1,
      page_size: 100,
    },
  })
}

export const createEndpoint = (payload: { pluginUniqueID: string, state: Record<string, any> }) => {
  const { pluginUniqueID, state } = payload
  const newName = state.name
  delete state.name
  return post('/workspaces/current/endpoints/create', {
    body: {
      plugin_unique_identifier: pluginUniqueID,
      settings: state,
      name: newName,
    },
  })
}

export const updateEndpoint = (payload: { endpointID: string, state: Record<string, any> }) => {
  const { endpointID, state } = payload
  const newName = state.name
  delete state.name
  return post('/workspaces/current/endpoints/update', {
    body: {
      endpoint_id: endpointID,
      settings: state,
      name: newName,
    },
  })
}

export const deleteEndpoint = (endpointID: string) => {
  return post('/workspaces/current/endpoints/delete', {
    body: {
      endpoint_id: endpointID,
    },
  })
}

export const enableEndpoint = (endpointID: string) => {
  return post('/workspaces/current/endpoints/enable', {
    body: {
      endpoint_id: endpointID,
    },
  })
}

export const disableEndpoint = (endpointID: string) => {
  return post('/workspaces/current/endpoints/disable', {
    body: {
      endpoint_id: endpointID,
    },
  })
}
