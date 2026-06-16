import type { PostAgentByAgentIdSkillsUploadResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { PostAppsByAppIdAgentSkillsUploadResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { AppListResponse, WorkflowOnlineUsersResponse } from '@/models/app'
import type { CommonResponse } from '@/models/common'
import type { AppModeEnum } from '@/types/app'
import { type } from '@orpc/contract'
import { base } from '../base'

export type AppListSortBy = 'last_modified' | 'recently_created' | 'earliest_created'
type AppListMode = AppModeEnum | 'agent' | 'channel' | 'all'

export type AppListQuery = {
  page?: number
  limit?: number
  name?: string
  mode?: AppListMode
  tag_ids?: string[]
  creator_ids?: string[]
  is_created_by_me?: boolean
  sort_by?: AppListSortBy
}

export const appListContract = base
  .route({
    path: '/apps',
    method: 'GET',
  })
  .input(type<{
    query?: AppListQuery
  }>())
  .output(type<AppListResponse>())

export const appDeleteContract = base
  .route({
    path: '/apps/{appId}',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<unknown>())

export const appStarredListContract = base
  .route({
    path: '/apps/starred',
    method: 'GET',
  })
  .input(type<{
    query?: AppListQuery
  }>())
  .output(type<AppListResponse>())

export const appStarContract = base
  .route({
    path: '/apps/{appId}/star',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<CommonResponse>())

export const appUnstarContract = base
  .route({
    path: '/apps/{appId}/star',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<CommonResponse>())

export const workflowOnlineUsersContract = base
  .route({
    path: '/apps/workflows/online-users',
    method: 'POST',
  })
  .input(type<{
    body: {
      app_ids: string[]
    }
  }>())
  .output(type<WorkflowOnlineUsersResponse>())

export const agentSkillUploadContract = base
  .route({
    path: '/apps/{app_id}/agent/skills/upload',
    method: 'POST',
    successStatus: 201,
  })
  .input(type<{
    params: {
      app_id: string
    }
    body: {
      file: File
    }
  }>())
  .output(type<PostAppsByAppIdAgentSkillsUploadResponse>())

export const agentAppSkillUploadContract = base
  .route({
    path: '/agent/{agent_id}/skills/upload',
    method: 'POST',
    successStatus: 201,
  })
  .input(type<{
    params: {
      agent_id: string
    }
    body: {
      file: File
    }
  }>())
  .output(type<PostAgentByAgentIdSkillsUploadResponse>())
