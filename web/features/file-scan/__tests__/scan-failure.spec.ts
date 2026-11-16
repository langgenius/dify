import type { TFunction } from 'i18next'
import type { FileScanFailure } from '../scan-failure'
import { ORPCError } from '@orpc/client'
import { useTranslation } from 'react-i18next'
import { fileScanFailureFromError, fileScanFailureMessage } from '../scan-failure'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: copy } = await import('@/i18n/locales/en-US/file-scan.json')
  return createReactI18nextMock(
    Object.fromEntries(Object.entries(copy).map(([key, value]) => [`fileScan.${key}`, value])),
  )
})

function scanRejection(code: string, details: Record<string, unknown>) {
  return new ORPCError(code, {
    status: 422,
    data: {
      code,
      message: 'English fallback sentence',
      status: 422,
      details: { code, ...details },
    },
  })
}

function failure(overrides: Partial<FileScanFailure>): FileScanFailure {
  return {
    code: 'file_scan_unavailable',
    fileName: 'report.pdf',
    providerName: 'Office scanner',
    retryable: false,
    threats: [],
    ...overrides,
  }
}

describe('fileScanFailureFromError', () => {
  it('reads the structured reason of a scan rejection', () => {
    expect(
      fileScanFailureFromError(
        scanRejection('file_scan_unscannable', {
          file_name: 'archive.zip',
          problem: 'encrypted',
          provider_name: 'Office scanner',
          provider_type: 'clamav',
          retryable: false,
          size_limit: null,
          threats: [],
        }),
        'fallback.zip',
      ),
    ).toEqual({
      code: 'file_scan_unscannable',
      fileName: 'archive.zip',
      problem: 'encrypted',
      providerName: 'Office scanner',
      retryable: false,
      threats: [],
    })
  })

  it('falls back to the local file name and treats missing details as not retryable', () => {
    const error = new ORPCError('file_scan_unavailable', { status: 422, data: {} })

    expect(fileScanFailureFromError(error, 'local.txt')).toMatchObject({
      code: 'file_scan_unavailable',
      fileName: 'local.txt',
      retryable: false,
    })
  })

  it('keeps a scan code this client does not know as a generic scan failure', () => {
    expect(
      fileScanFailureFromError(scanRejection('file_scan_future_reason', {}), 'a.txt')?.code,
    ).toBe('file_scan_unknown')
  })

  it('ignores every error that is not a scan rejection', () => {
    expect(
      fileScanFailureFromError(new ORPCError('invalid_param', { status: 422 }), 'a.txt'),
    ).toBeUndefined()
    expect(
      fileScanFailureFromError(new ORPCError('file_scan_unavailable', { status: 503 }), 'a.txt'),
    ).toBeUndefined()
    expect(fileScanFailureFromError(new Error('response lost'), 'a.txt')).toBeUndefined()
  })
})

describe('fileScanFailureMessage', () => {
  // boundary: the shared mock stands in for i18next; the sentences are the real English copy.
  const t = useTranslation(['fileScan']).t as unknown as TFunction<['fileScan']>

  it.each<[Partial<FileScanFailure>, string]>([
    [
      { code: 'file_scan_malware_detected', threats: ['Eicar-Test-Signature', 'Trojan.Generic'] },
      'report.pdf was blocked: Eicar-Test-Signature, Trojan.Generic detected (Office scanner). The original file has been deleted.',
    ],
    [
      { code: 'file_scan_malware_detected' },
      'report.pdf was blocked: malware detected (Office scanner). The original file has been deleted.',
    ],
    [
      { code: 'file_scan_unscannable', problem: 'encrypted' },
      'report.pdf could not be scanned: the file is encrypted or password-protected. Remove the password and upload it again.',
    ],
    [
      { code: 'file_scan_unscannable', problem: 'too_large' },
      "report.pdf could not be scanned: the file exceeds the scanning service's size limit.",
    ],
    [
      { code: 'file_scan_unscannable', problem: 'unsupported' },
      'report.pdf could not be scanned: the scanning service does not support this file.',
    ],
    [
      { code: 'file_scan_unavailable' },
      'The scanner “Office scanner” is temporarily unavailable, so report.pdf was not processed. Try again later.',
    ],
    [
      { code: 'file_scan_provider_auth_failed' },
      'The credentials for the scanner “Office scanner” are invalid, so report.pdf was not processed. Ask a workspace admin to update them.',
    ],
    [
      { code: 'file_scan_provider_quota_exceeded' },
      'The scanner “Office scanner” has used up its quota, so report.pdf was not processed. Contact a workspace admin.',
    ],
    [
      { code: 'file_scan_provider_missing', providerName: undefined },
      'The scanner selected for this knowledge base is not available, so report.pdf was not processed. Choose another one in the knowledge base settings.',
    ],
    [
      { code: 'file_scan_file_missing' },
      'report.pdf is no longer available for scanning. Upload it again.',
    ],
    [{ code: 'file_scan_pending' }, 'report.pdf is still being scanned. Try again in a moment.'],
    [
      { code: 'file_scan_unknown' },
      'report.pdf did not pass the malware scan and was not processed.',
    ],
  ])('states the file, the reason and the next step for %o', (overrides, sentence) => {
    expect(fileScanFailureMessage(t, failure(overrides))).toBe(sentence)
  })
})
