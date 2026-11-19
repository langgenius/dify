import type { RbacRole, RbacRoleList } from '@dify/contracts/api/console/workspaces/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import type { Role, RoleListRequest, RoleListResponse } from '@/models/access-control'
import { consoleQuery } from '@/service/console'

const ROLE_TYPES = new Set<string>(['workspace', 'app', 'dataset'])
const ROLE_TAGS = new Set<string>(['owner', 'admin'])

// The API serializes every field but declares defaulted ones as optional strings.
export const toRole = (role: RbacRole): Role => ({
  id: role.id,
  tenant_id: role.tenant_id ?? '',
  type: ROLE_TYPES.has(role.type) ? (role.type as Role['type']) : 'workspace',
  category: role.category === 'global_system_default' ? role.category : 'global_custom',
  name: role.name,
  description: role.description ?? '',
  is_builtin: role.is_builtin ?? false,
  permission_keys: role.permission_keys ?? [],
  role_tag:
    role.role_tag && ROLE_TAGS.has(role.role_tag) ? (role.role_tag as Role['role_tag']) : '',
})

// Stands in for a selected role whose full definition has not been loaded.
export const createSelectedRolePlaceholder = ({
  id,
  name,
}: {
  id: string
  name?: string
}): Role => ({
  id,
  tenant_id: '',
  type: 'workspace',
  category: 'global_custom',
  name: name ?? id,
  description: '',
  is_builtin: false,
  permission_keys: [],
  role_tag: '',
})

const toRoleListPage = (page: RbacRoleList): RoleListResponse => ({
  data: (page.data ?? []).map(toRole),
  pagination: {
    total_count: page.pagination?.total_count ?? 0,
    per_page: page.pagination?.per_page ?? 0,
    current_page: page.pagination?.current_page ?? 0,
    total_pages: page.pagination?.total_pages ?? 0,
  },
})

export const workspaceRoleListInfiniteOptions = ({ page = 1, ...query }: RoleListRequest) =>
  consoleQuery.workspaces.current.rbac.roles.get.infiniteOptions({
    input: (pageParam: number) => ({ query: { ...query, page: pageParam } }),
    initialPageParam: page,
    getNextPageParam: ({ pagination }) => {
      const currentPage = pagination?.current_page ?? 0
      return currentPage < (pagination?.total_pages ?? 0) ? currentPage + 1 : undefined
    },
    select: (data): InfiniteData<RoleListResponse, number> => ({
      ...data,
      pages: data.pages.map(toRoleListPage),
    }),
  })
