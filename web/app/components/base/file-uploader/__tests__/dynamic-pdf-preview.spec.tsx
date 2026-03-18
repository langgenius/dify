import { fireEvent, render, screen } from '@testing-library/react'
import DynamicPdfPreview from '../dynamic-pdf-preview'

type DynamicPdfPreviewProps = {
  url: string
  onCancel: () => void
}

type DynamicLoader = () => Promise<unknown> | undefined
type DynamicOptions = {
  ssr?: boolean
}

const mockState = vi.hoisted(() => ({
  loader: undefined as DynamicLoader | undefined,
  options: undefined as DynamicOptions | undefined,
}))

const mockDynamicRender = vi.hoisted(() => vi.fn())

const mockDynamic = vi.hoisted(() =>
  vi.fn((loader: DynamicLoader, options: DynamicOptions) => {
    mockState.loader = loader
    mockState.options = options

    const MockDynamicPdfPreview = ({ url, onCancel }: DynamicPdfPreviewProps) => {
      mockDynamicRender({ url, onCancel })
      return (
        <button data-testid="dynamic-pdf-preview" data-url={url} onClick={onCancel}>
          Dynamic PDF Preview
        </button>
      )
    }

    return MockDynamicPdfPreview
  }),
)

const mockPdfPreview = vi.hoisted(() =>
  vi.fn(() => null),
)

vi.mock('@/next/dynamic', () => ({
  default: mockDynamic,
}))

vi.mock('../pdf-preview', () => ({
  default: mockPdfPreview,
}))

describe('dynamic-pdf-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should configure next/dynamic with ssr disabled', () => {
    expect(mockState.loader).toEqual(expect.any(Function))
    expect(mockState.options).toEqual({ ssr: false })
  })

  it('should render the dynamic component and forward props', () => {
    const onCancel = vi.fn()
    render(<DynamicPdfPreview url="https://example.com/test.pdf" onCancel={onCancel} />)

    const trigger = screen.getByTestId('dynamic-pdf-preview')
    expect(trigger).toHaveAttribute('data-url', 'https://example.com/test.pdf')
    expect(mockDynamicRender).toHaveBeenCalledWith({
      url: 'https://example.com/test.pdf',
      onCancel,
    })

    fireEvent.click(trigger)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should return pdf-preview module when loader is executed in browser-like environment', async () => {
    const loaded = mockState.loader?.()
    expect(loaded).toBeInstanceOf(Promise)

    const loadedModule = (await loaded) as { default: unknown }
    const pdfPreviewModule = await import('../pdf-preview')
    expect(loadedModule.default).toBe(pdfPreviewModule.default)
  })

  it('should return undefined when loader runs without window', () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: undefined,
    })

    try {
      const loaded = mockState.loader?.()
      expect(loaded).toBeUndefined()
    }
    finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: originalWindow,
      })
    }
  })
})
