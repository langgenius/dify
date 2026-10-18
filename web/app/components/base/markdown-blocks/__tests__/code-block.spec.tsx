import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@/types/app'
import { CodeBlock } from '../code-block'

const { mockHighlightCode } = vi.hoisted(() => ({
  mockHighlightCode: vi.fn(),
}))

type UseThemeReturn = {
  theme: Theme
}

const mockUseTheme = vi.fn<() => UseThemeReturn>(() => ({ theme: Theme.light }))
const mockEcharts = vi.hoisted(() => {
  const state = {
    option: undefined as unknown,
    theme: undefined as string | undefined,
    finishedHandler: undefined as undefined | ((event?: unknown) => void),
    echartsInstance: {
      resize: vi.fn<(opts?: { width?: string; height?: string }) => void>(),
      trigger: vi.fn((eventName: string, event?: unknown) => {
        if (eventName === 'finished') state.finishedHandler?.(event)
      }),
    },
    getInstanceByDom: vi.fn(() => state.echartsInstance),
  }

  return state
})

let clientWidthSpy: { mockRestore: () => void } | null = null
let clientHeightSpy: { mockRestore: () => void } | null = null
let offsetWidthSpy: { mockRestore: () => void } | null = null
let offsetHeightSpy: { mockRestore: () => void } | null = null
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null

type AudioContextCtor = new () => unknown
type WindowWithLegacyAudio = Window & {
  AudioContext?: AudioContextCtor
  webkitAudioContext?: AudioContextCtor
  abcjsAudioContext?: unknown
}

let originalAudioContext: AudioContextCtor | undefined
let originalWebkitAudioContext: AudioContextCtor | undefined

class MockAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}

  resume = vi.fn(async () => undefined)

  decodeAudioData = vi.fn(async (_data: ArrayBuffer, success?: (audioBuffer: unknown) => void) => {
    const mockAudioBuffer = {}
    success?.(mockAudioBuffer)
    return mockAudioBuffer
  })

  createBufferSource = vi.fn(() => ({
    buffer: null as unknown,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: undefined as undefined | (() => void),
  }))
}

vi.mock('@/hooks/use-theme', () => ({
  __esModule: true,
  default: () => mockUseTheme(),
}))

vi.mock('../shiki-highlight', () => ({
  highlightCode: mockHighlightCode,
}))

vi.mock('../../svg-gallery', () => ({
  default: ({ content }: { content: string }) => <div data-testid="svg-renderer">{content}</div>,
}))

vi.mock('echarts', () => ({
  getInstanceByDom: mockEcharts.getInstanceByDom,
}))

vi.mock('echarts-for-react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  const MockReactEcharts = React.forwardRef(
    (
      {
        onChartReady,
        onEvents,
        option,
        theme,
      }: {
        option: unknown
        theme?: string
        onChartReady?: (instance: typeof mockEcharts.echartsInstance) => void
        onEvents?: { finished?: (event?: unknown) => void }
      },
      ref: React.ForwardedRef<{ getEchartsInstance: () => typeof mockEcharts.echartsInstance }>,
    ) => {
      mockEcharts.option = option
      mockEcharts.theme = theme
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => mockEcharts.echartsInstance,
      }))

      React.useEffect(() => {
        mockEcharts.finishedHandler = onEvents?.finished
        onChartReady?.(mockEcharts.echartsInstance)
        onEvents?.finished?.({})
        return () => {
          mockEcharts.finishedHandler = undefined
        }
      }, [onChartReady, onEvents])

      return <div className="echarts-for-react" />
    },
  )

  return {
    __esModule: true,
    default: MockReactEcharts,
  }
})

vi.mock('@/app/components/base/mermaid', () => ({
  __esModule: true,
  default: ({ PrimitiveCode }: { PrimitiveCode: string }) => (
    <div data-testid="mock-mermaid">{PrimitiveCode}</div>
  ),
}))

const findEchartsHost = async () => {
  await waitFor(() => {
    expect(document.querySelector('.echarts-for-react'))!.toBeInTheDocument()
  })
  return document.querySelector('.echarts-for-react') as HTMLDivElement
}

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTheme.mockReturnValue({ theme: Theme.light })
    mockHighlightCode.mockImplementation(async ({ code, language }) => (
      <pre className="shiki">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    ))
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
    clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    offsetWidthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
    offsetHeightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)

    const windowWithLegacyAudio = window as WindowWithLegacyAudio
    originalAudioContext = windowWithLegacyAudio.AudioContext
    originalWebkitAudioContext = windowWithLegacyAudio.webkitAudioContext
    windowWithLegacyAudio.AudioContext = MockAudioContext as AudioContextCtor
    windowWithLegacyAudio.webkitAudioContext = MockAudioContext as AudioContextCtor
    delete windowWithLegacyAudio.abcjsAudioContext
  })

  afterEach(() => {
    vi.useRealTimers()
    consoleErrorSpy?.mockRestore()
    consoleWarnSpy?.mockRestore()
    consoleErrorSpy = null
    consoleWarnSpy = null
    clientWidthSpy?.mockRestore()
    clientHeightSpy?.mockRestore()
    offsetWidthSpy?.mockRestore()
    offsetHeightSpy?.mockRestore()
    clientWidthSpy = null
    clientHeightSpy = null
    offsetWidthSpy = null
    offsetHeightSpy = null

    const windowWithLegacyAudio = window as WindowWithLegacyAudio
    if (originalAudioContext) windowWithLegacyAudio.AudioContext = originalAudioContext
    else delete windowWithLegacyAudio.AudioContext

    if (originalWebkitAudioContext)
      windowWithLegacyAudio.webkitAudioContext = originalWebkitAudioContext
    else delete windowWithLegacyAudio.webkitAudioContext

    delete windowWithLegacyAudio.abcjsAudioContext
    originalAudioContext = undefined
    originalWebkitAudioContext = undefined
  })

  // Base rendering behaviors for inline and language labels.
  describe('Rendering', () => {
    it('should render inline code element when inline prop is true', () => {
      const { container } = render(
        <CodeBlock inline className="language-javascript">
          const a=1;
        </CodeBlock>,
      )

      const code = container.querySelector('code')
      expect(code).toBeTruthy()
      expect(code?.textContent).toBe('const a=1;')
    })

    it('should render code element when className is not provided', () => {
      const { container } = render(<CodeBlock>plain text</CodeBlock>)

      expect(container.querySelector('code')?.textContent).toBe('plain text')
    })

    it('should render syntax-highlighted output when language is standard', async () => {
      render(<CodeBlock className="language-javascript">const x = 1;</CodeBlock>)

      expect(screen.getByText('JavaScript'))!.toBeInTheDocument()
      await waitFor(() => {
        expect(document.querySelector('code.language-javascript')?.textContent).toContain(
          'const x = 1;',
        )
      })
    })

    it('should format unknown language labels with capitalized fallback when language is not in map', () => {
      render(<CodeBlock className="language-ruby">puts "ok"</CodeBlock>)

      expect(screen.getByText('Ruby'))!.toBeInTheDocument()
    })

    it('should render mermaid block when language is mermaid', async () => {
      render(<CodeBlock className="language-mermaid">{'graph TD; A-->B;'}</CodeBlock>)

      expect(screen.getByText('Mermaid'))!.toBeInTheDocument()
      expect(await screen.findByTestId('mock-mermaid'))!.toHaveTextContent('graph TD; A-->B;')
    })

    it('should hide svg renderer when toggle is clicked for svg language', async () => {
      const user = userEvent.setup()
      render(<CodeBlock className="language-svg">{'<svg/>'}</CodeBlock>)

      expect(await screen.findByTestId('svg-renderer')).toHaveTextContent('<svg/>')
      const svgToggleButton = screen.getByRole('button', { name: 'SVG' })
      expect(svgToggleButton).toHaveAttribute('aria-pressed', 'true')
      await user.click(svgToggleButton)

      expect(svgToggleButton).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByTestId('svg-renderer')).not.toBeInTheDocument()
    })

    it('should render syntax-highlighted output when language is standard and app theme is dark', async () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark })

      render(<CodeBlock className="language-javascript">const y = 2;</CodeBlock>)

      expect(screen.getByText('JavaScript'))!.toBeInTheDocument()
      await waitFor(() => {
        expect(document.querySelector('code.language-javascript')?.textContent).toContain(
          'const y = 2;',
        )
      })
    })

    it('should fall back to plain code block when shiki highlighting fails', async () => {
      mockHighlightCode.mockRejectedValueOnce(new Error('highlight failed'))

      render(<CodeBlock className="language-javascript">const z = 3;</CodeBlock>)

      await waitFor(() => {
        expect(screen.getByText('const z = 3;'))!.toBeInTheDocument()
      })
      expect(document.querySelector('code.language-javascript')).toBeNull()
    })
  })

  // ECharts behaviors for loading, parsing, and chart lifecycle updates.
  describe('ECharts', () => {
    it('should show loading indicator when echarts content is empty', () => {
      render(<CodeBlock className="language-echarts"></CodeBlock>)

      expect(screen.getByText(/Chart loading.../i))!.toBeInTheDocument()
    })

    it('should keep loading when echarts content is whitespace only', () => {
      render(<CodeBlock className="language-echarts">{'   '}</CodeBlock>)

      expect(screen.getByText(/Chart loading.../i))!.toBeInTheDocument()
    })

    it('should render echarts with parsed option when JSON is valid', async () => {
      const option = { title: [{ text: 'Hello' }] }
      render(<CodeBlock className="language-echarts">{JSON.stringify(option)}</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
      expect(mockEcharts.option).toEqual(option)
      expect(screen.queryByText(/Chart loading.../i)).not.toBeInTheDocument()
    })

    it('should use error option when echarts content is invalid but structurally complete', async () => {
      render(<CodeBlock className="language-echarts">{'{a:1}'}</CodeBlock>)

      await findEchartsHost()
      expect(mockEcharts.option).toEqual({ title: { text: 'ECharts error - Wrong option.' } })
    })

    it('should use error option when echarts content is invalid non-structured text', async () => {
      render(<CodeBlock className="language-echarts">{'not a json {'}</CodeBlock>)

      await findEchartsHost()
      expect(mockEcharts.option).toEqual({ title: { text: 'ECharts error - Wrong option.' } })
    })

    it('should keep loading when option is valid JSON but not an object', async () => {
      render(<CodeBlock className="language-echarts">"text-value"</CodeBlock>)

      expect(await screen.findByText(/Chart loading.../i))!.toBeInTheDocument()
    })

    it('should keep loading when echarts content matches incomplete quote-pattern guard', async () => {
      render(<CodeBlock className="language-echarts">{'x{"a":1'}</CodeBlock>)

      expect(await screen.findByText(/Chart loading.../i))!.toBeInTheDocument()
    })

    it('should keep loading when echarts content has unmatched opening array bracket', async () => {
      render(<CodeBlock className="language-echarts">[[1,2]</CodeBlock>)

      expect(await screen.findByText(/Chart loading.../i))!.toBeInTheDocument()
    })

    it('debounces resize after the lazy chart becomes ready and cancels pending work on unmount', async () => {
      const { unmount } = render(
        <CodeBlock className="language-echarts">{'{"series":[]}'}</CodeBlock>,
      )
      await findEchartsHost()
      // Start deterministic time after the lazy import has completed.
      vi.useFakeTimers()
      mockEcharts.echartsInstance.resize.mockClear()
      act(() => {
        window.dispatchEvent(new Event('resize'))
        window.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(199)
      })
      expect(mockEcharts.echartsInstance.resize).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(mockEcharts.echartsInstance.resize).toHaveBeenCalledOnce()
      act(() => window.dispatchEvent(new Event('resize')))
      unmount()
      act(() => {
        window.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(500)
      })
      expect(mockEcharts.echartsInstance.resize).toHaveBeenCalledOnce()
    })

    it('should switch from loading to chart when streaming content becomes valid JSON', async () => {
      const { rerender } = render(<CodeBlock className="language-echarts">{'{ "a":'}</CodeBlock>)
      expect(screen.getByText(/Chart loading.../i))!.toBeInTheDocument()

      rerender(<CodeBlock className="language-echarts">{'{ "a": 1 }'}</CodeBlock>)

      expect(await findEchartsHost())!.toBeInTheDocument()
    })

    it('should render dark themed echarts path when app theme is dark', async () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark })
      render(<CodeBlock className="language-echarts">{'{"series":[]}'}</CodeBlock>)

      expect(await findEchartsHost())!.toBeInTheDocument()
    })
  })
})
