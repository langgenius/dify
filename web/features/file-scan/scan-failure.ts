import type { TFunction } from 'i18next'
import { ORPCError } from '@orpc/client'

const FILE_SCAN_ERROR_PREFIX = 'file_scan_'
export const FILE_SCAN_PENDING_CODE = 'file_scan_pending'

const KNOWN_FAILURE_CODES = [
  'file_scan_malware_detected',
  'file_scan_unscannable',
  'file_scan_unavailable',
  FILE_SCAN_PENDING_CODE,
  'file_scan_provider_auth_failed',
  'file_scan_provider_quota_exceeded',
  'file_scan_provider_missing',
  'file_scan_file_missing',
] as const

type KnownFileScanFailureCode = (typeof KNOWN_FAILURE_CODES)[number]
type FileScanProblem = 'encrypted' | 'too_large' | 'unsupported'

export type FileScanFailure = {
  /** `file_scan_unknown` covers codes a newer backend may add. */
  code: KnownFileScanFailureCode | 'file_scan_unknown'
  fileName: string
  problem?: FileScanProblem
  providerName?: string
  /** Whether claiming the same staged upload again can succeed. */
  retryable: boolean
  threats: string[]
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

/**
 * Reads the structured reason of a rejected claim. Returns `undefined` for every error that is
 * not a malware-scan rejection, so callers keep their existing handling for those.
 */
export function fileScanFailureFromError(
  error: unknown,
  fallbackFileName: string,
): FileScanFailure | undefined {
  if (!(error instanceof ORPCError) || error.status !== 422) return undefined
  const body = asRecord(error.data)
  const details = asRecord(body?.details)
  const rawCode = nonEmptyString(details?.code) ?? nonEmptyString(body?.code) ?? String(error.code)
  if (!rawCode.startsWith(FILE_SCAN_ERROR_PREFIX)) return undefined

  const code = KNOWN_FAILURE_CODES.find((known) => known === rawCode) ?? 'file_scan_unknown'
  const problem = details?.problem
  return {
    code,
    fileName: nonEmptyString(details?.file_name) ?? fallbackFileName,
    problem:
      problem === 'encrypted' || problem === 'too_large' || problem === 'unsupported'
        ? problem
        : undefined,
    providerName: nonEmptyString(details?.provider_name) ?? nonEmptyString(details?.provider_type),
    retryable: details?.retryable === true,
    threats: Array.isArray(details?.threats)
      ? details.threats.filter((threat): threat is string => Boolean(nonEmptyString(threat)))
      : [],
  }
}

/** One localized sentence naming the file, the reason and the next step. */
export function fileScanFailureMessage(t: TFunction<['fileScan']>, failure: FileScanFailure) {
  const file = failure.fileName
  const provider = failure.providerName ?? t(($) => $['policy.scanner'], { ns: 'fileScan' })
  switch (failure.code) {
    case 'file_scan_malware_detected':
      return failure.threats.length
        ? t(($) => $['upload.failure.malware'], {
            ns: 'fileScan',
            file,
            provider,
            threats: failure.threats.join(', '),
          })
        : t(($) => $['upload.failure.malwareUnnamed'], { ns: 'fileScan', file, provider })
    case 'file_scan_unscannable':
      if (failure.problem === 'encrypted')
        return t(($) => $['upload.failure.encrypted'], { ns: 'fileScan', file })
      if (failure.problem === 'too_large')
        return t(($) => $['upload.failure.tooLarge'], { ns: 'fileScan', file })
      return t(($) => $['upload.failure.unsupported'], { ns: 'fileScan', file })
    case 'file_scan_unavailable':
      return t(($) => $['upload.failure.unavailable'], { ns: 'fileScan', file, provider })
    case 'file_scan_pending':
      return t(($) => $['upload.failure.pending'], { ns: 'fileScan', file })
    case 'file_scan_provider_auth_failed':
      return t(($) => $['upload.failure.authFailed'], { ns: 'fileScan', file, provider })
    case 'file_scan_provider_quota_exceeded':
      return t(($) => $['upload.failure.quotaExceeded'], { ns: 'fileScan', file, provider })
    case 'file_scan_provider_missing':
      return t(($) => $['upload.failure.providerMissing'], { ns: 'fileScan', file })
    case 'file_scan_file_missing':
      return t(($) => $['upload.failure.fileMissing'], { ns: 'fileScan', file })
    default:
      return t(($) => $['upload.failure.generic'], { ns: 'fileScan', file })
  }
}
