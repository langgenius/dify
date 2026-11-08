import type { ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { cloneElement, createRef, useEffect, useRef, useState } from 'react'
import { SkillPdfPreview } from '@/features/skills/detail/skill-pdf-preview'
import { PdfPreview } from '../pdf-preview'

// Replicates react-pdf-highlighter's PdfLoader contract: it renders `beforeLoad`
// while loading, `children(pdfDocument)` on success, and — only when an
// `errorMessage` element is provided — that element (with an `error` prop
// injected) on failure. Without `errorMessage` a failed load renders nothing.
// Like the real loader it reloads on remount, so tests control attempts through
// the `key` the previews bump.
type FakeLoaderProps = {
  url: string
  beforeLoad: ReactElement
  errorMessage?: ReactElement
  children: (pdfDocument: { numPages: number }) => ReactElement
}

const attempts = new Map<string, number>()

function FakePdfLoader({ url, beforeLoad, errorMessage, children }: FakeLoaderProps) {
  // Count mounts, not renders: a remount (fresh `key`) starts a new load attempt.
  const seqRef = useRef<number | undefined>(undefined)
  if (seqRef.current === undefined) {
    seqRef.current = (attempts.get(url) ?? 0) + 1
    attempts.set(url, seqRef.current)
  }
  const attempt = seqRef.current
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 0)
    return () => clearTimeout(timer)
  }, [])
  if (!loaded) return beforeLoad
  const failsForever = url.startsWith('fail:')
  const failsOnce = url.startsWith('fail-once:') && attempt === 1
  if (failsForever || failsOnce) {
    if (!errorMessage) return null
    return cloneElement(errorMessage as ReactElement<{ error?: Error }>, {
      error: new Error('InvalidPDF'),
    })
  }
  return children({ numPages: 1 })
}

vi.mock('../pdf-highlighter-adapter', () => ({
  PdfLoader: FakePdfLoader,
  PdfHighlighter: () => <div>pdf-content</div>,
}))

beforeEach(() => attempts.clear())

describe('PdfPreview load failure', () => {
  it('renders a load-failure state with retry when the PDF fails to load', async () => {
    const popupRef = createRef<HTMLDivElement>()
    render(<PdfPreview url="fail-once://document.pdf" popupRef={popupRef} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeInTheDocument()
  })

  it('recovers the document after retry remounts the loader', async () => {
    const popupRef = createRef<HTMLDivElement>()
    render(<PdfPreview url="fail-once://document.pdf" popupRef={popupRef} />)

    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(await screen.findByText('pdf-content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the failure state when a retry fails again', async () => {
    const popupRef = createRef<HTMLDivElement>()
    render(<PdfPreview url="fail://document.pdf" popupRef={popupRef} />)

    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('does not render the failure state while the PDF loads or after it succeeds', async () => {
    const popupRef = createRef<HTMLDivElement>()
    const { rerender } = render(<PdfPreview url="ok://document.pdf" popupRef={popupRef} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    rerender(<PdfPreview url="ok://document.pdf" popupRef={popupRef} />)
    expect(await screen.findByText('pdf-content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('SkillPdfPreview load failure', () => {
  it('renders a load-failure state with retry and recovers after retry', async () => {
    render(<SkillPdfPreview fileName="guide.pdf" url="fail-once://skill-guide.pdf" />)

    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(await screen.findByText('pdf-content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
