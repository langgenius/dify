import type { HumanInputFormDefinition } from '@/features/human-input-form/types'

export type HumanInputV2AccessResponse = {
  challengeToken: string
  resendAfterSeconds: number
  expiresInSeconds: number
}

export type HumanInputV2Challenge = HumanInputV2AccessResponse & {
  receivedAt: number
  resendAt: number
  expiresAt: number
}

export type HumanInputV2SubmitPayload = {
  inputs: Record<string, unknown>
  action: string
  otp_code: string
  challenge_token: string
}

export type HumanInputV2UploadToken = {
  uploadToken: string
  expiresAt: number
}

export type HumanInputV2UploadedFile = {
  id: string
  name: string
  mimeType: string
  size: number
  url: string
}

export type HumanInputV2RequestOptions = {
  signal?: AbortSignal
}

export type HumanInputV2FormTransport = {
  getForm: (
    token: string,
    options?: HumanInputV2RequestOptions,
  ) => Promise<HumanInputFormDefinition>
  requestAccess: (
    token: string,
    options?: HumanInputV2RequestOptions,
  ) => Promise<HumanInputV2AccessResponse>
  submit: (
    token: string,
    payload: HumanInputV2SubmitPayload,
    options?: HumanInputV2RequestOptions,
  ) => Promise<void>
  requestUploadToken: (
    token: string,
    options?: HumanInputV2RequestOptions,
  ) => Promise<HumanInputV2UploadToken>
  uploadLocalFile: (
    token: string,
    file: File,
    options?: HumanInputV2RequestOptions,
  ) => Promise<HumanInputV2UploadedFile>
  uploadRemoteFile: (
    token: string,
    url: string,
    options?: HumanInputV2RequestOptions,
  ) => Promise<HumanInputV2UploadedFile>
}

export type HumanInputV2ErrorCategory =
  | 'not-found'
  | 'form-expired'
  | 'already-submitted'
  | 'form-rate-limit'
  | 'access-rate-limit'
  | 'access-delivery-failed'
  | 'invalid-otp'
  | 'challenge-expired'
  | 'challenge-stale'
  | 'upload-failed'
  | 'network'
  | 'unavailable'
  | 'unknown'
