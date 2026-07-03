import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type { RolesOfMemberResponse, UpdateRolesOfMemberRequest } from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, put } from '../base'
import { commonQueryKeys } from '../use-common'

const NAME_SPACE = 'rbac-member-roles'

export const useRolesOfMember = (memberId: string, language: AccessControlTemplateLanguage) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'member-roles', memberId, language],
    queryFn: () => get<RolesOfMemberResponse>(`/workspaces/current/rbac/members/${memberId}/rbac-roles`, {
      params: {
        language,
      },
    }),
  })
}

export const useUpdateRolesOfMember = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-member-roles'],
    mutationFn: (request: UpdateRolesOfMemberRequest) => {
      const { memberId, roleIds } = request
      return put<RolesOfMemberResponse>(`/workspaces/current/rbac/members/${memberId}/rbac-roles`, {
        body: { role_ids: roleIds },
      })
    },
    onSuccess: (_, { memberId }) => Promise.all([
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'member-roles', memberId] }),
      queryClient.invalidateQueries({ queryKey: commonQueryKeys.members }),
    ]),
  })
}
