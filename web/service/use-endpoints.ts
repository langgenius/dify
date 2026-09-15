import type { EndpointsResponse } from '@/app/components/plugins/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from './base'
import { consoleClient, consoleQuery } from './client'

const NAME_SPACE = 'endpoints'
const endpointContract = consoleQuery.workspaces.current.endpoints
const endpointClient = consoleClient.workspaces.current.endpoints

export const useEndpointList = (pluginID: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'list', pluginID],
    queryFn: () =>
      get<EndpointsResponse>('/workspaces/current/endpoints/list/plugin', {
        params: {
          plugin_id: pluginID,
          page: 1,
          page_size: 100,
        },
      }),
  })
}

export const useInvalidateEndpointList = () => {
  const queryClient = useQueryClient()
  return (pluginID: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'list', pluginID],
    })
  }
}

export const useCreateEndpoint = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void
  onError?: (error: any) => void
}) => {
  return useMutation({
    mutationKey: endpointContract.post.mutationKey(),
    mutationFn: (payload: { pluginUniqueID: string; state: Record<string, any> }) => {
      const { pluginUniqueID, state } = payload
      const { name, ...settings } = state
      return endpointClient.post({
        body: {
          plugin_unique_identifier: pluginUniqueID,
          settings,
          name,
        },
      })
    },
    onSuccess,
    onError,
  })
}

export const useUpdateEndpoint = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void
  onError?: (error: any) => void
}) => {
  return useMutation({
    mutationKey: endpointContract.byId.patch.mutationKey(),
    mutationFn: (payload: { endpointID: string; state: Record<string, any> }) => {
      const { endpointID, state } = payload
      const { name, ...settings } = state
      return endpointClient.byId.patch({
        params: {
          id: endpointID,
        },
        body: {
          settings,
          name,
        },
      })
    },
    onSuccess,
    onError,
  })
}

export const useDeleteEndpoint = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void
  onError?: (error: any) => void
}) => {
  return useMutation({
    mutationKey: endpointContract.byId.delete.mutationKey(),
    mutationFn: (endpointID: string) => {
      return endpointClient.byId.delete({
        params: {
          id: endpointID,
        },
      })
    },
    onSuccess,
    onError,
  })
}

export const useEnableEndpoint = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void
  onError?: (error: any) => void
}) => {
  return useMutation({
    mutationKey: endpointContract.enable.post.mutationKey(),
    mutationFn: (endpointID: string) => {
      return endpointClient.enable.post({
        body: {
          endpoint_id: endpointID,
        },
      })
    },
    onSuccess,
    onError,
  })
}

export const useDisableEndpoint = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void
  onError?: (error: any) => void
}) => {
  return useMutation({
    mutationKey: endpointContract.disable.post.mutationKey(),
    mutationFn: (endpointID: string) => {
      return endpointClient.disable.post({
        body: {
          endpoint_id: endpointID,
        },
      })
    },
    onSuccess,
    onError,
  })
}
