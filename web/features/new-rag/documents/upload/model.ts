import type { DocumentUploadIssue } from '../../document-upload-policy'

export const DOCUMENT_STAGING_REQUEST_TIMEOUT = 30_000

export class DocumentStagingCanceledError extends Error {
  constructor() {
    super('Document staging was canceled')
    this.name = 'DocumentStagingCanceledError'
  }
}

export class DocumentStagingTimeoutError extends Error {
  constructor() {
    super('Document staging timed out')
    this.name = 'DocumentStagingTimeoutError'
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
