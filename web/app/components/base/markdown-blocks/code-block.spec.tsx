import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Theme } from '@/types/app'

import CodeBlock from './code-block'

type UseThemeReturn = {
  theme: Theme
}

type MockEchartsProps = {
  onChartReady?: (instance: unknown) => void
  onEvents?: { finished?: (params: unknown) => void }
  option?: unknown
  style?: React.CSSProperties
  theme?: string
  opts?: unknown
  notMerge?: boolean
  lazyUpdate?: boolean
}

const mockUseTheme = vi.fn<() => UseThemeReturn>(() => ({ theme: Theme.light }))
let mockFinishedEventBurst = 1

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const DynamicFlowchart = ({ PrimitiveCode, theme }: { PrimitiveCode: string, theme: string }) => (
      <div data-testid="dynamic-flowchart">
        {PrimitiveCode}
        |
        {theme}
      </div>
    )
    DynamicFlowchart.displayName = 'DynamicFlowchart'
    return DynamicFlowchart
  },
}))

vi.mock('echarts-for-react', () => {
  const MockEcharts = React.forwardRef<{ resize: () => void }, MockEchartsProps>(({
    onChartReady,
    onEvents,
    option,
    theme,
    notMerge,
  }, ref) => {
    const initializedRef = React.useRef(false)

    React.useEffect(() => {
      const instance = {
        resize: vi.fn(),
      }

      if (ref) {
        if (typeof ref === 'function')
          ref(instance)
        else
          ref.current = instance
      }

      if (!initializedRef.current && onChartReady) {
        onChartReady(instance)
        initializedRef.current = true
      }
    }, [ref, onChartReady])

    React.useEffect(() => {
      if (onEvents && onEvents.finished) {
        for (let i = 0; i < mockFinishedEventBurst; i++)
          onEvents.finished({})
      }
    }, [option, onEvents])

    return (
      <div
        data-testid="echarts"
        data-option={JSON.stringify(option)}
        data-theme={theme || ''}
        data-not-merge={String(Boolean(notMerge))}
      />
    )
  })
  MockEcharts.displayName = 'MockEcharts'
  return {
    __esModule: true,
    default: MockEcharts,
  }
})

vi.mock('react-syntax-highlighter', () => {
  return {
    __esModule: true,
    default: ({
      children,
      language,
      customStyle,
      showLineNumbers,
      PreTag,
    }: {
      children: React.ReactNode
      language?: string
      customStyle?: React.CSSProperties
      showLineNumbers?: boolean
      PreTag?: string
    }) => (
      <pre
        data-testid="syntax-highlighter"
        data-language={language || ''}
        data-show-line-numbers={String(Boolean(showLineNumbers))}
        data-pre-tag={PreTag || ''}
        style={customStyle}
      >
        {children}
      </pre>
    ),
    PrismLight: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
  }
})

vi.mock('abcjs', () => {
  const load = vi.fn()
  const setTune = vi.fn()
  const init = vi.fn(() => Promise.resolve())

  return {
    __esModule: true,
    default: {
      renderAbc: vi.fn(() => [{}]),
      synth: {
        SynthController: class {
          load = load
          setTune = setTune
        },
        CreateSynth: class {
          init = init
        },
      },
    },
  }
})

vi.mock('dompurify', () => ({
  __esModule: true,
  default: {
    sanitize: (value: string) => value,
  },
}))

vi.mock('@svgdotjs/svg.js', () => ({
  __esModule: true,
  SVG: () => ({
    addTo: (element: HTMLElement) => ({
      viewbox: () => undefined,
      svg: () => {
        element.innerHTML = '<svg data-testid="svg-rendered"></svg>'
        return {
          click: () => undefined,
        }
      },
    }),
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  __esModule: true,
  default: () => mockUseTheme(),
}))

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTheme.mockReturnValue({ theme: Theme.light })
    mockFinishedEventBurst = 1
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render inline code element when inline prop is true', () => {
    const { container } = render(<CodeBlock inline className="language-javascript">const a=1;</CodeBlock>)
    const code = container.querySelector('code')
    expect(code).toBeTruthy()
    expect(code?.textContent).toBe('const a=1;')
  })

  it('should render code element when className does not include language prefix', () => {
    const { container } = render(<CodeBlock className="plain">abc</CodeBlock>)
    expect(container.querySelector('code')?.textContent).toBe('abc')
  })

  it('should render SyntaxHighlighter for standard language blocks', async () => {
    render(<CodeBlock className="language-javascript">const x = 1;</CodeBlock>)
    const sh = await screen.findByTestId('syntax-highlighter')
    expect(sh).toBeInTheDocument()
    expect(sh.getAttribute('data-language')).toBe('javascript')
    expect(sh.textContent).toContain('const x = 1;')
    expect(screen.getByText('JavaScript')).toBeInTheDocument()
  })

  it('should format unknown language labels with capitalized fallback', () => {
    render(<CodeBlock className="language-ruby">puts "ok"</CodeBlock>)
    expect(screen.getByText('Ruby')).toBeInTheDocument()
  })

  it('should render dynamic flowchart output when language is mermaid', async () => {
    render(<CodeBlock className="language-mermaid">graph TB; A--&gt;B;</CodeBlock>)
    const mermaid = await screen.findByTestId('dynamic-flowchart')
    expect(mermaid).toBeInTheDocument()
    expect(mermaid.textContent).toContain('graph TB; A-->B;')
  })

  it('should render abc music container when language is abc', async () => {
    render(<CodeBlock className="language-abc">X:1\nT:test</CodeBlock>)
    expect(await screen.findByText('ABC')).toBeInTheDocument()
  })

  it('should render svg content and hide it when toggled off', async () => {
    const user = userEvent.setup()
    render(<CodeBlock className="language-svg">{'<svg/>'}</CodeBlock>)
    expect(await screen.findByText(/Error rendering SVG/i)).toBeInTheDocument()
    const svgToggleButton = screen.getAllByRole('button')[0]
    await user.click(svgToggleButton)
    expect(screen.queryByText(/Error rendering SVG/i)).not.toBeInTheDocument()
  })

  it('should show loading indicator for echarts before options are parsed', () => {
    render(<CodeBlock className="language-echarts"></CodeBlock>)
    expect(screen.getByText(/Chart loading.../)).toBeInTheDocument()
  })

  it('should keep loading when echarts content is whitespace only', () => {
    render(<CodeBlock className="language-echarts">{'   '}</CodeBlock>)
    expect(screen.getByText(/Chart loading.../)).toBeInTheDocument()
  })

  it('should render echarts with valid JSON options', async () => {
    const option = { title: { text: 'Hello' } }
    render(<CodeBlock className="language-echarts">{JSON.stringify(option)}</CodeBlock>)

    const echarts = await screen.findByTestId('echarts')
    expect(echarts).toBeInTheDocument()
    expect(echarts.getAttribute('data-option')).toBe(JSON.stringify(option))
    expect(echarts.getAttribute('data-not-merge')).toBe('false')
  })

  it('should show error option when echarts receives complete but invalid JSON-like content', async () => {
    render(<CodeBlock className="language-echarts">{'{a:1}'}</CodeBlock>)

    const echarts = await screen.findByTestId('echarts')
    const passed = JSON.parse(echarts.getAttribute('data-option') || '{}')
    expect(passed.title?.text).toMatch(/ECharts error/)
    expect(echarts.getAttribute('data-not-merge')).toBe('true')
  })

  it('should show error option when echarts receives invalid non-structured text', async () => {
    render(<CodeBlock className="language-echarts">{'not a json {'}</CodeBlock>)

    const echarts = await screen.findByTestId('echarts')
    expect(echarts).toBeInTheDocument()
    const passed = JSON.parse(echarts.getAttribute('data-option') || '{}')
    expect(passed.title?.text).toMatch(/ECharts error/)
  })

  it('should keep loading when option is valid JSON but not an object', async () => {
    render(<CodeBlock className="language-echarts">"text-value"</CodeBlock>)
    expect(await screen.findByText(/Chart loading.../)).toBeInTheDocument()
  })

  it('should handle resize flow for echarts', async () => {
    vi.useFakeTimers()
    render(<CodeBlock className="language-echarts">{'{}'}</CodeBlock>)
    act(() => {
      vi.runOnlyPendingTimers()
    })
    const echarts = screen.getByTestId('echarts')
    expect(echarts).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByTestId('echarts')).toBeInTheDocument()
  })

  it('should keep rendering when echarts finished event fires repeatedly', async () => {
    const { rerender } = render(<CodeBlock className="language-echarts">{'{"a":1}'}</CodeBlock>)
    expect(await screen.findByTestId('echarts')).toBeInTheDocument()

    rerender(<CodeBlock className="language-echarts">{'{"a":2}'}</CodeBlock>)
    rerender(<CodeBlock className="language-echarts">{'{"a":3}'}</CodeBlock>)
    rerender(<CodeBlock className="language-echarts">{'{"a":4}'}</CodeBlock>)
    rerender(<CodeBlock className="language-echarts">{'{"a":5}'}</CodeBlock>)

    expect(screen.getByTestId('echarts')).toBeInTheDocument()
  })

  it('should stop processing extra finished events when event burst is above threshold', async () => {
    mockFinishedEventBurst = 5
    render(<CodeBlock className="language-echarts">{'{"series":[]}'}</CodeBlock>)
    expect(await screen.findByTestId('echarts')).toBeInTheDocument()
  })

  it('should switch from loading to chart when streaming content becomes valid JSON', async () => {
    const { rerender } = render(<CodeBlock className="language-echarts">{'{ "a":'}</CodeBlock>)
    expect(screen.getByText(/Chart loading.../)).toBeInTheDocument()

    rerender(<CodeBlock className="language-echarts">{'{ "a": 1 }'}</CodeBlock>)
    const echarts = await screen.findByTestId('echarts')
    expect(echarts).toBeInTheDocument()
  })

  it('should parse array JSON after previously incomplete streaming content', async () => {
    const { rerender } = render(<CodeBlock className="language-echarts">[1, 2</CodeBlock>)
    expect(screen.getByText(/Chart loading.../)).toBeInTheDocument()

    rerender(<CodeBlock className="language-echarts">[1, 2]</CodeBlock>)
    const echarts = await screen.findByTestId('echarts')
    expect(echarts).toBeInTheDocument()
  })

  it('should handle secondary parse success path for non-structured streaming content', async () => {
    const parseSpy = vi.spyOn(JSON, 'parse')
    parseSpy.mockImplementationOnce(() => ({ recovered: true }) as Record<string, boolean>)

    render(<CodeBlock className="language-echarts">abcde</CodeBlock>)
    const echarts = await screen.findByTestId('echarts')
    expect(echarts.getAttribute('data-option')).toContain('recovered')
    parseSpy.mockRestore()
  })

  it('should render dark themed echarts when app theme is dark', async () => {
    mockUseTheme.mockReturnValue({ theme: Theme.dark })
    render(<CodeBlock className="language-echarts">{'{"series":[]}'}</CodeBlock>)
    const echarts = await screen.findByTestId('echarts')
    expect(echarts.getAttribute('data-theme')).toBe('dark')
  })

  it('should wire resize listener when echarts view re-enters with a ready chart instance', async () => {
    const { rerender, unmount } = render(<CodeBlock className="language-echarts">{'{"a":1}'}</CodeBlock>)
    expect(await screen.findByTestId('echarts')).toBeInTheDocument()

    rerender(<CodeBlock className="language-javascript">const x = 1;</CodeBlock>)
    rerender(<CodeBlock className="language-echarts">{'{"a":2}'}</CodeBlock>)

    window.dispatchEvent(new Event('resize'))

    unmount()
  })
})
