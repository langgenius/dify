import type { PostFilesUploadResponse } from '@dify/contracts/api/console/files/types.gen'
import { type } from '@orpc/contract'
import { base } from '../base'

export const fileUploadContract = base
  .route({
    path: '/files/upload',
    method: 'POST',
    successStatus: 201,
  })
  .input(type<{
    body: {
      file: File
    }
  }>())
  .output(type<PostFilesUploadResponse>())
