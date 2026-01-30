import type {
  SandboxFileDownloadRequest,
  SandboxFileDownloadTicket,
  SandboxFileListQuery,
  SandboxFileNode,
} from '@/types/sandbox-file'
import { type } from '@orpc/contract'
import { base } from '../base'

export const listFilesContract = base
  .route({
    path: '/apps/{appId}/sandbox/files',
    method: 'GET',
  })
  .input(type<{
    params: { appId: string }
    query?: SandboxFileListQuery
  }>())
  .output(type<SandboxFileNode[]>())

export const downloadFileContract = base
  .route({
    path: '/apps/{appId}/sandbox/files/download',
    method: 'POST',
  })
  .input(type<{
    params: { appId: string }
    body: SandboxFileDownloadRequest
  }>())
  .output(type<SandboxFileDownloadTicket>())
