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
    path: '/sandboxes/{sandboxId}/files',
    method: 'GET',
  })
  .input(type<{
    params: { sandboxId: string }
    query?: SandboxFileListQuery
  }>())
  .output(type<SandboxFileNode[]>())

export const downloadFileContract = base
  .route({
    path: '/sandboxes/{sandboxId}/files/download',
    method: 'POST',
  })
  .input(type<{
    params: { sandboxId: string }
    body: SandboxFileDownloadRequest
  }>())
  .output(type<SandboxFileDownloadTicket>())
