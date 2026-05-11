import type {
  EndpointsResponse,
} from '@/app/components/plugins/types'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { get, post } from './base'

const NAME_SPACE = 'endpoints'

export const useEndpointList = (pluginID: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'list', pluginID],
    queryFn: () => get<EndpointsResponse>('/workspaces/current/endpoints/list/plugin', {
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
    queryClient.invalidateQueries(
      {
        queryKey: [NAME_SPACE, 'list', pluginID],
      },
    )
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
    mutationKey: [NAME_SPACE, 'create'],
    mutationFn: (payload: { pluginUniqueID: string, state: Record<string, any> }) => {
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
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (payload: { endpointID: string, state: Record<string, any> }) => {
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
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: (endpointID: string) => {
      return post('/workspaces/current/endpoints/delete', {
        body: {
          endpoint_id: endpointID,
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
    mutationKey: [NAME_SPACE, 'enable'],
    mutationFn: (endpointID: string) => {
      return post('/workspaces/current/endpoints/enable', {
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
    mutationKey: [NAME_SPACE, 'disable'],
    mutationFn: (endpointID: string) => {
      return post('/workspaces/current/endpoints/disable', {
        body: {
          endpoint_id: endpointID,
        },
      })
    },
    onSuccess,
    onError,
  })
}
