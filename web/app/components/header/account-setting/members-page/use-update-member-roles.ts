import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import { useMutation } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function useUpdateMemberRoles(allowMultipleRoles: boolean, onSuccess?: () => void) {
  const mutation = useMutation(
    consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.put.mutationOptions({
      context: { silent: true },
      // Keep the shared onSettled cache policy; owner effects survive observer unmount.
      onSuccess,
    }),
  )

  const variables = (memberId: AccountWithRoleResponse['id'], roles: Role[]) => {
    const selectedRoles = allowMultipleRoles ? roles : roles.slice(0, 1)
    return {
      params: { member_id: memberId },
      body: { role_ids: selectedRoles.map((role) => role.id) },
    }
  }

  return {
    ...mutation,
    submit: (memberId: AccountWithRoleResponse['id'], roles: Role[]) =>
      mutation.mutate(variables(memberId, roles)),
    submitAsync: (memberId: AccountWithRoleResponse['id'], roles: Role[]) =>
      mutation.mutateAsync(variables(memberId, roles)),
  }
}
