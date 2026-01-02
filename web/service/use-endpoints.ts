import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createEndpoint,
  deleteEndpoint,
  disableEndpoint,
  enableEndpoint,
  fetchEndpointList,
  updateEndpoint,
} from './endpoints'

const NAME_SPACE = 'endpoints'

export const useEndpointList = (pluginID: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'list', pluginID],
    queryFn: () => fetchEndpointList(pluginID),
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
      return createEndpoint(payload)
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
      return updateEndpoint(payload)
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
      return deleteEndpoint(endpointID)
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
      return enableEndpoint(endpointID)
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
      return disableEndpoint(endpointID)
    },
    onSuccess,
    onError,
  })
}
