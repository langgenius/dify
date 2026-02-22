import type { ChatConfig } from '@/app/components/base/chat/types'
import type { AccessMode } from '@/models/access-control'
import type { Banner } from '@/models/app'
import type { App, AppCategory, InstalledApp } from '@/models/explore'
import type { AppMeta } from '@/models/share'
import type { AppModeEnum } from '@/types/app'
import { type } from '@orpc/contract'
import { base } from '../base'

export type ExploreAppsResponse = {
  categories: AppCategory[]
  recommended_apps: App[]
}

export type ExploreAppDetailResponse = {
  id: string
  name: string
  icon: string
  icon_background: string
  mode: AppModeEnum
  export_data: string
  can_trial?: boolean
}

export type InstalledAppsResponse = {
  installed_apps: InstalledApp[]
}

export type InstalledAppMutationResponse = {
  result: string
  message: string
}

export type AppAccessModeResponse = {
  accessMode: AccessMode
}

export const exploreAppsContract = base
  .route({
    path: '/explore/apps',
    method: 'GET',
  })
  .input(type<{ query?: { language?: string } }>())
  .output(type<ExploreAppsResponse>())

export const exploreAppDetailContract = base
  .route({
    path: '/explore/apps/{id}',
    method: 'GET',
  })
  .input(type<{ params: { id: string } }>())
  .output(type<ExploreAppDetailResponse | null>())

export const exploreInstalledAppsContract = base
  .route({
    path: '/installed-apps',
    method: 'GET',
  })
  .input(type<{ query?: { app_id?: string } }>())
  .output(type<InstalledAppsResponse>())

export const exploreInstalledAppUninstallContract = base
  .route({
    path: '/installed-apps/{id}',
    method: 'DELETE',
  })
  .input(type<{ params: { id: string } }>())
  .output(type<unknown>())

export const exploreInstalledAppPinContract = base
  .route({
    path: '/installed-apps/{id}',
    method: 'PATCH',
  })
  .input(type<{
    params: { id: string }
    body: {
      is_pinned: boolean
    }
  }>())
  .output(type<InstalledAppMutationResponse>())

export const exploreInstalledAppAccessModeContract = base
  .route({
    path: '/enterprise/webapp/app/access-mode',
    method: 'GET',
  })
  .input(type<{ query: { appId: string } }>())
  .output(type<AppAccessModeResponse>())

export const exploreInstalledAppParametersContract = base
  .route({
    path: '/installed-apps/{appId}/parameters',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<ChatConfig>())

export const exploreInstalledAppMetaContract = base
  .route({
    path: '/installed-apps/{appId}/meta',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<AppMeta>())

export const exploreBannersContract = base
  .route({
    path: '/explore/banners',
    method: 'GET',
  })
  .input(type<{ query?: { language?: string } }>())
  .output(type<Banner[]>())
