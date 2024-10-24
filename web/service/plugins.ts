import type { Fetcher } from 'swr'
import { del, get, post, upload } from './base'
import type {
  CreateEndpointRequest,
  EndpointOperationResponse,
  EndpointsRequest,
  EndpointsResponse,
  InstallPackageResponse,
  UpdateEndpointRequest,
} from '@/app/components/plugins/types'
import type { DebugInfo as DebugInfoTypes } from '@/app/components/plugins/types'

export const createEndpoint: Fetcher<EndpointOperationResponse, { url: string; body: CreateEndpointRequest }> = ({ url, body }) => {
  // url = /workspaces/current/endpoints/create
  return post<EndpointOperationResponse>(url, { body })
}

export const fetchEndpointList: Fetcher<EndpointsResponse, { url: string; params?: EndpointsRequest }> = ({ url, params }) => {
  // url = /workspaces/current/endpoints/list/plugin?plugin_id=xxx
  return get<EndpointsResponse>(url, { params })
}

export const deleteEndpoint: Fetcher<EndpointOperationResponse, { url: string; endpointID: string }> = ({ url, endpointID }) => {
  // url = /workspaces/current/endpoints/delete
  return del<EndpointOperationResponse>(url, { body: { endpoint_id: endpointID } })
}

export const updateEndpoint: Fetcher<EndpointOperationResponse, { url: string; body: UpdateEndpointRequest }> = ({ url, body }) => {
  // url = /workspaces/current/endpoints/update
  return post<EndpointOperationResponse>(url, { body })
}

export const enableEndpoint: Fetcher<EndpointOperationResponse, { url: string; endpointID: string }> = ({ url, endpointID }) => {
  // url = /workspaces/current/endpoints/enable
  return post<EndpointOperationResponse>(url, { body: { endpoint_id: endpointID } })
}

export const disableEndpoint: Fetcher<EndpointOperationResponse, { url: string; endpointID: string }> = ({ url, endpointID }) => {
  // url = /workspaces/current/endpoints/disable
  return post<EndpointOperationResponse>(url, { body: { endpoint_id: endpointID } })
}

export const installPackageFromGitHub: Fetcher<InstallPackageResponse, { repo: string; version: string; package: string }> = ({ repo, version, package: packageName }) => {
  return post<InstallPackageResponse>('/workspaces/current/plugin/upload/github', {
    body: { repo, version, package: packageName },
  })
}

export const fetchDebugKey = async () => {
  return get<DebugInfoTypes>('/workspaces/current/plugin/debugging-key')
}

export const uploadPackageFile = async (file: File) => {
  const formData = new FormData()
  formData.append('pkg', file)
  return upload({
    xhr: new XMLHttpRequest(),
    data: formData,
  }, false, '/workspaces/current/plugin/upload/pkg')
}
