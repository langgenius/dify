import type { ExternalConnectionPreview } from '../external-roster-preview'

export type ExternalConnectionSettings = {
  endpoint: string
  authentication: 'none' | 'bearer'
  token: string
}

export type ExternalConnectionFailureReason =
  | 'unreachable'
  | 'authentication'
  | 'unsupported'
  | 'invalid-agent-card'
  | 'unknown'

export type ExternalConnectionVerificationResult =
  | { status: 'verified'; agent: ExternalConnectionPreview }
  | { status: 'failed'; reason: ExternalConnectionFailureReason }

export type ExternalConnectionVerificationState =
  | { status: 'unverified' | 'verifying' }
  | ExternalConnectionVerificationResult

export type VerifyExternalConnection = (
  settings: ExternalConnectionSettings,
) => Promise<ExternalConnectionVerificationResult>
