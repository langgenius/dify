import type {
  AppAssetDeleteResponse,
  AppAssetFileDownloadUrlResponse,
  AppAssetNode,
  AppAssetPublishResponse,
  AppAssetTreeResponse,
  CreateFolderPayload,
  MoveNodePayload,
  RenameNodePayload,
  ReorderNodePayload,
} from '@/types/app-asset'
import { type } from '@orpc/contract'
import { base } from '../base'

export const treeContract = base
  .route({
    path: '/apps/{appId}/assets/tree',
    method: 'GET',
  })
  .input(type<{
    params: { appId: string }
  }>())
  .output(type<AppAssetTreeResponse>())

export const createFolderContract = base
  .route({
    path: '/apps/{appId}/assets/folders',
    method: 'POST',
  })
  .input(type<{
    params: { appId: string }
    body: CreateFolderPayload
  }>())
  .output(type<AppAssetNode>())

export const createFileContract = base
  .route({
    path: '/apps/{appId}/assets/files',
    method: 'POST',
  })
  .input(type<{
    params: { appId: string }
  }>())
  .output(type<AppAssetNode>())

export const getFileContentContract = base
  .route({
    path: '/apps/{appId}/assets/files/{nodeId}',
    method: 'GET',
  })
  .input(type<{
    params: { appId: string, nodeId: string }
  }>())
  .output(type<{ content: string }>())

export const getFileDownloadUrlContract = base
  .route({
    path: '/apps/{appId}/assets/files/{nodeId}/download-url',
    method: 'GET',
  })
  .input(type<{
    params: { appId: string, nodeId: string }
  }>())
  .output(type<AppAssetFileDownloadUrlResponse>())

export const updateFileContentContract = base
  .route({
    path: '/apps/{appId}/assets/files/{nodeId}',
    method: 'PUT',
  })
  .input(type<{
    params: { appId: string, nodeId: string }
    body: { content: string }
  }>())
  .output(type<AppAssetNode>())

export const deleteNodeContract = base
  .route({
    path: '/apps/{appId}/assets/nodes/{nodeId}',
    method: 'DELETE',
  })
  .input(type<{
    params: { appId: string, nodeId: string }
  }>())
  .output(type<AppAssetDeleteResponse>())

export const renameNodeContract = base
  .route({
    path: '/apps/{appId}/assets/nodes/{nodeId}/rename',
    method: 'POST',
  })
  .input(type<{
    params: { appId: string, nodeId: string }
    body: RenameNodePayload
  }>())
  .output(type<AppAssetNode>())

export const moveNodeContract = base
  .route({
    path: '/apps/{appId}/assets/nodes/{nodeId}/move',
    method: 'POST',
  })
  .input(type<{
    params: { appId: string, nodeId: string }
    body: MoveNodePayload
  }>())
  .output(type<AppAssetNode>())

export const reorderNodeContract = base
  .route({
    path: '/apps/{appId}/assets/nodes/{nodeId}/reorder',
    method: 'POST',
  })
  .input(type<{
    params: { appId: string, nodeId: string }
    body: ReorderNodePayload
  }>())
  .output(type<AppAssetNode>())

export const publishContract = base
  .route({
    path: '/apps/{appId}/assets/publish',
    method: 'POST',
  })
  .input(type<{
    params: { appId: string }
  }>())
  .output(type<AppAssetPublishResponse>())
