import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, put } from './base'

const CREDENTIAL_VISIBILITY_API = '/workspaces/current/credentials'

type VisibilityResponse = {
  visibility: string
  partial_member_list: string[]
}

type UpdateVisibilityPayload = {
  visibility: string
  member_ids?: Array<{ user_id: string }>
}

export const useCredentialVisibility = (credentialType: string, credentialId: string) => {
  return useQuery<VisibilityResponse>({
    queryKey: ['credentialVisibility', credentialType, credentialId],
    queryFn: () => get<VisibilityResponse>(`${CREDENTIAL_VISIBILITY_API}/${credentialType}/${credentialId}/visibility`),
    enabled: !!credentialType && !!credentialId,
  })
}

export const useUpdateCredentialVisibility = (credentialType: string, credentialId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: UpdateVisibilityPayload) =>
      put(`${CREDENTIAL_VISIBILITY_API}/${credentialType}/${credentialId}/visibility`, { body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentialVisibility', credentialType, credentialId] })
    },
  })
}
