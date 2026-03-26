import type { DSLImportResponse, WorkflowOnlineUsersResponse } from '@/models/app'
import { type } from '@orpc/contract'
import { base } from '../base'

export type AppExportBundleResponse = {
  download_url: string
  filename: string
}

export type AppRuntimeUpgradeResponse = {
  result: 'success' | 'no_draft' | 'already_sandboxed'
  new_app_id?: string
  converted_agents?: number
  skipped_agents?: number
}

export type PublishToCreatorsPlatformResponse = {
  redirect_url: string
}

export type ImportBundlePrepareResponse = {
  import_id: string
  upload_url: string
}

export const workflowOnlineUsersContract = base
  .route({
    path: '/apps/workflows/online-users',
    method: 'GET',
  })
  .input(type<{
    query: {
      workflow_ids: string
    }
  }>())
  .output(type<WorkflowOnlineUsersResponse>())

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

export const appExportBundleContract = base
  .route({
    path: '/apps/{appId}/export-bundle',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
    query?: {
      include_secret?: boolean
      workflow_id?: string
    }
  }>())
  .output(type<AppExportBundleResponse>())

export const publishToCreatorsPlatformContract = base
  .route({
    path: '/apps/{appId}/publish-to-creators-platform',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<PublishToCreatorsPlatformResponse>())

export const upgradeAppRuntimeContract = base
  .route({
    path: '/apps/{appId}/upgrade-runtime',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<AppRuntimeUpgradeResponse>())

export const prepareImportBundleContract = base
  .route({
    path: '/apps/imports-bundle/prepare',
    method: 'POST',
  })
  .output(type<ImportBundlePrepareResponse>())

export const confirmImportBundleContract = base
  .route({
    path: '/apps/imports-bundle/{importId}/confirm',
    method: 'POST',
  })
  .input(type<{
    params: {
      importId: string
    }
    body?: {
      name?: string
      description?: string
      icon_type?: string
      icon?: string
      icon_background?: string
    }
  }>())
  .output(type<DSLImportResponse>())
