import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type { RolesOfMemberResponse } from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, put } from '../base'

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
    mutationFn: ({ memberId, roleIds }: { memberId: string, roleIds: string[] }) =>
      put(`/workspaces/current/rbac/members/${memberId}/rbac-roles`, {
        body: { role_ids: roleIds },
      }),
    onSuccess: (_, { memberId }) => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'member-roles', memberId] })
    },
  })
}
