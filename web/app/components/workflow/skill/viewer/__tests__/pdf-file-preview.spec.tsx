import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'

import PdfFilePreview from '../pdf-file-preview'

const mocks = vi.hoisted(() => ({
  hotkeys: new Map<string, () => void>(),
  highlighterProps: null as null | Record<string, unknown>,
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: (keys: string, callback: () => void) => {
    mocks.hotkeys.set(keys, callback)
  },
}))

vi.mock('react-pdf-highlighter', () => ({
  PdfLoader: ({ children, beforeLoad }: { children: (doc: unknown) => ReactNode, beforeLoad: ReactNode }) => (
    <div data-testid="pdf-loader">
      {beforeLoad}
      {children({ numPages: 1 })}
    </div>
  ),
  PdfHighlighter: (props: Record<string, unknown>) => {
    mocks.highlighterProps = props
    return <div data-testid="pdf-highlighter" />
  },
}))

const getScaleContainer = () => {
  const container = document.querySelector('div[style*="transform"]') as HTMLDivElement | null
  expect(container).toBeInTheDocument()
  return container!
}

describe('PdfFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hotkeys.clear()
    mocks.highlighterProps = null
  })

  it('should render the pdf viewer and loading state', () => {
    render(<PdfFilePreview downloadUrl="https://example.com/demo.pdf" />)

    expect(screen.getByTestId('pdf-loader')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-highlighter')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should zoom with toolbar controls and hotkeys', () => {
    render(<PdfFilePreview downloadUrl="https://example.com/demo.pdf" />)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(getScaleContainer().getAttribute('style')).toContain('scale(1.2)')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(getScaleContainer().getAttribute('style')).toContain('scale(1)')

    act(() => {
      mocks.hotkeys.get('up')?.()
    })
    expect(getScaleContainer().getAttribute('style')).toContain('scale(1.2)')

    act(() => {
      mocks.hotkeys.get('down')?.()
    })
    expect(getScaleContainer().getAttribute('style')).toContain('scale(1)')
  })

  it('should provide the non-interactive highlighter callbacks expected by the viewer', () => {
    render(<PdfFilePreview downloadUrl="https://example.com/demo.pdf" />)

    expect(mocks.highlighterProps).toBeTruthy()
    expect((mocks.highlighterProps?.enableAreaSelection as () => boolean)()).toBe(false)
    expect((mocks.highlighterProps?.onSelectionFinished as () => null)()).toBeNull()

    const highlight = (mocks.highlighterProps?.highlightTransform as () => ReactNode)()
    const { container } = render(<>{highlight}</>)
    expect(container.firstChild?.nodeName).toBe('DIV')
  })
})
