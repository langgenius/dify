import type { FileScanFailure } from '@/features/file-scan/scan-failure'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentUploadFileList } from '../file-list'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const mock = createReactI18nextMock()

  return {
    ...mock,
    useTranslation: (namespace?: string | readonly string[]) => {
      const translation = mock.useTranslation(namespace)
      return {
        ...translation,
        i18n: { ...translation.i18n, language: 'tr-TR' },
      }
    },
  }
})

describe('DocumentUploadFileList', () => {
  it('keeps technical file extensions locale independent', () => {
    const file = new File(['key=value'], 'config.properties', { type: 'text/plain' })

    render(
      <DocumentUploadFileList
        disabled={false}
        fileSizeLimitMb={10}
        items={[{ file, id: 'file-1' }]}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText(/PROPERTIES/)).toBeVisible()
    expect(screen.queryByText(/PROPERTİES/)).not.toBeInTheDocument()
  })

  it('explains each file the malware scan rejected and offers retry only when it can help', async () => {
    const user = userEvent.setup()
    const blocked = new File(['x'], 'invoice.pdf', { type: 'application/pdf' })
    const waiting = new File(['y'], 'notes.txt', { type: 'text/plain' })
    const scanning = new File(['z'], 'draft.txt', { type: 'text/plain' })
    const failure = (overrides: Partial<FileScanFailure>): FileScanFailure => ({
      code: 'file_scan_unavailable',
      fileName: 'notes.txt',
      providerName: 'Office scanner',
      retryable: true,
      threats: [],
      ...overrides,
    })
    const onRetry = vi.fn()

    render(
      <DocumentUploadFileList
        disabled={false}
        fileSizeLimitMb={10}
        items={[
          { file: blocked, id: 'blocked' },
          { file: waiting, id: 'waiting' },
          { file: scanning, id: 'scanning' },
        ]}
        uploadFailures={
          new Map([
            [
              blocked,
              failure({
                code: 'file_scan_malware_detected',
                fileName: 'invoice.pdf',
                retryable: false,
                threats: ['Eicar-Test-Signature'],
              }),
            ],
            [waiting, failure({})],
          ])
        }
        uploadProgress={
          new Map([
            [blocked, 'failed'],
            [waiting, 'failed'],
            [scanning, 'scanning'],
          ])
        }
        onRemove={vi.fn()}
        onRetry={onRetry}
      />,
    )

    expect(
      screen.getByText(
        'fileScan.upload.failure.malware:{"file":"invoice.pdf","provider":"Office scanner","threats":"Eicar-Test-Signature"}',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        'fileScan.upload.failure.unavailable:{"file":"notes.txt","provider":"Office scanner"}',
      ),
    ).toBeVisible()
    expect(screen.getByText('fileScan.upload.scanning')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'fileScan.upload.retryFile:{"file":"invoice.pdf"}' }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'fileScan.upload.retryFile:{"file":"notes.txt"}' }),
    )
    expect(onRetry).toHaveBeenCalledWith({ file: waiting, id: 'waiting' })
  })
})
