import type { Member } from '@/models/common'
import type {
  PlatformAdminMemberPasswordResetPayload,
  PlatformAdminWorkspaceCreateResponse,
  PlatformAdminWorkspaceInviteResponse,
  PlatformAdminWorkspaceListResponse,
  PlatformAdminWorkspaceMembersResponse,
} from '@/models/platform-admin'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, patch, post, put } from './base'

type PlatformAdminWorkspaceQueryParams = {
  keyword?: string
}

type CreateWorkspacePayload = {
  name: string
  owner_email?: string
  owner_name?: string
}

type InviteWorkspaceMembersPayload = {
  emails: string[]
  role: Exclude<Member['role'], 'owner'>
  language: string
}

type UpdateWorkspaceMemberRolePayload = {
  memberId: string
  role: Exclude<Member['role'], 'owner'>
}

const platformAdminWorkspaceListStaleTime = 30 * 1000
const platformAdminWorkspaceMemberListStaleTime = 15 * 1000

export const platformAdminKeys = {
  all: ['platform-admin'] as const,
  workspaces: () => [...platformAdminKeys.all, 'workspaces'] as const,
  workspaceList: (params: PlatformAdminWorkspaceQueryParams) => [...platformAdminKeys.workspaces(), params] as const,
  workspaceMembers: (workspaceId: string) => [...platformAdminKeys.all, 'workspace-members', workspaceId] as const,
}

const invalidatePlatformAdminWorkspaces = (queryClient: ReturnType<typeof useQueryClient>) => {
  return queryClient.invalidateQueries({
    queryKey: platformAdminKeys.workspaces(),
  })
}

const invalidatePlatformAdminWorkspaceMembers = (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) => {
  if (!workspaceId)
    return Promise.resolve()

  return queryClient.invalidateQueries({
    queryKey: platformAdminKeys.workspaceMembers(workspaceId),
    exact: true,
  })
}

export const usePlatformAdminWorkspaces = (
  params: PlatformAdminWorkspaceQueryParams,
  enabled: boolean,
) => {
  return useQuery<PlatformAdminWorkspaceListResponse>({
    queryKey: platformAdminKeys.workspaceList(params),
    queryFn: () => get<PlatformAdminWorkspaceListResponse>('/platform-admin/workspaces', {
      params: {
        page: 1,
        limit: 200,
        keyword: params.keyword,
      },
    }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: platformAdminWorkspaceListStaleTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const usePlatformAdminWorkspaceMembers = (
  workspaceId: string,
  enabled: boolean,
) => {
  return useQuery<PlatformAdminWorkspaceMembersResponse>({
    queryKey: platformAdminKeys.workspaceMembers(workspaceId),
    queryFn: () => get<PlatformAdminWorkspaceMembersResponse>(`/platform-admin/workspaces/${workspaceId}/members`),
    enabled,
    staleTime: platformAdminWorkspaceMemberListStaleTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const useCreatePlatformAdminWorkspace = () => {
  const queryClient = useQueryClient()

  return useMutation<PlatformAdminWorkspaceCreateResponse, Error, CreateWorkspacePayload>({
    mutationFn: body => post<PlatformAdminWorkspaceCreateResponse>('/platform-admin/workspaces', { body }),
    onSuccess: async () => {
      await invalidatePlatformAdminWorkspaces(queryClient)
    },
  })
}

export const useRenamePlatformAdminWorkspace = (workspaceId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => patch<PlatformAdminWorkspaceCreateResponse>(`/platform-admin/workspaces/${workspaceId}`, {
      body: { name },
    }),
    onSuccess: async () => {
      await invalidatePlatformAdminWorkspaces(queryClient)
    },
  })
}

export const useDeletePlatformAdminWorkspace = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (workspaceId: string) => del(`/platform-admin/workspaces/${workspaceId}`),
    onSuccess: async () => {
      await invalidatePlatformAdminWorkspaces(queryClient)
    },
  })
}

export const useInvitePlatformAdminWorkspaceMembers = (workspaceId: string) => {
  const queryClient = useQueryClient()

  return useMutation<PlatformAdminWorkspaceInviteResponse, Error, InviteWorkspaceMembersPayload>({
    mutationFn: body => post<PlatformAdminWorkspaceInviteResponse>(`/platform-admin/workspaces/${workspaceId}/members/invite`, {
      body,
    }),
    onSuccess: async () => {
      await Promise.all([
        invalidatePlatformAdminWorkspaces(queryClient),
        invalidatePlatformAdminWorkspaceMembers(queryClient, workspaceId),
      ])
    },
  })
}

export const useUpdatePlatformAdminWorkspaceMemberRole = (workspaceId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ memberId, role }: UpdateWorkspaceMemberRolePayload) => put(`/platform-admin/workspaces/${workspaceId}/members/${memberId}/role`, {
      body: { role },
    }),
    onSuccess: async () => {
      await invalidatePlatformAdminWorkspaceMembers(queryClient, workspaceId)
    },
  })
}

export const useDeletePlatformAdminWorkspaceMember = (workspaceId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (memberId: string) => del(`/platform-admin/workspaces/${workspaceId}/members/${memberId}`),
    onSuccess: async () => {
      await Promise.all([
        invalidatePlatformAdminWorkspaces(queryClient),
        invalidatePlatformAdminWorkspaceMembers(queryClient, workspaceId),
      ])
    },
  })
}

export const useResetPlatformAdminWorkspaceMemberPassword = (workspaceId: string) => {
  return useMutation({
    mutationFn: ({ memberId, new_password, password_confirm }: PlatformAdminMemberPasswordResetPayload) => {
      return post(`/platform-admin/workspaces/${workspaceId}/members/${memberId}/password`, {
        body: {
          new_password,
          password_confirm,
        },
      })
    },
  })
}
