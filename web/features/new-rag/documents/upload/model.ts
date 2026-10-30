import type { DocumentUploadIssue } from '../../upload/policy'

export class DocumentStagingCanceledError extends Error {
  constructor() {
    super('Document staging was canceled')
    this.name = 'DocumentStagingCanceledError'
  }
}

type UploadApiExclusionReason =
  | 'batchLimit'
  | 'countLimit'
  | 'fileSize'
  | 'fileType'
  | 'processing'
  | 'quota'
  | 'target'

export type UploadExclusionReasonKey = DocumentUploadIssue | UploadApiExclusionReason
