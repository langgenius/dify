import { fireEvent, render, screen } from '@testing-library/react'
import PdfPreviewError from '../pdf-preview-error'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'common.operation.pdfLoadFailed': 'Failed to load the PDF. Please try again.',
    'common.operation.retry': 'Retry',
  })
})

describe('PdfPreviewError', () => {
  it('announces the failure and offers a retry action', () => {
    const onRetry = vi.fn()

    render(<PdfPreviewError onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Failed to load the PDF. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('calls onRetry when the retry action is used', () => {
    const onRetry = vi.fn()

    render(<PdfPreviewError onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  // PdfLoader clones the error element and injects the load error.
  it('accepts the error prop injected by PdfLoader', () => {
    render(<PdfPreviewError onRetry={vi.fn()} error={new Error('boom')} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
