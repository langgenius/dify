import { createRequire } from 'node:module'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Theme } from '@/types/app'

import CodeBlock from './code-block'

type UseThemeReturn = {
  theme: Theme
}

const mockUseTheme = vi.fn<() => UseThemeReturn>(() => ({ theme: Theme.light }))
const require = createRequire(import.meta.url)
const echartsCjs = require('echarts') as {
  getInstanceByDom: (dom: HTMLDivElement | null) => {
    resize: (opts?: { width?: string, height?: string }) => void
  } | null
}

let clientWidthSpy: { mockRestore: () => void } | null = null
let clientHeightSpy: { mockRestore: () => void } | null = null
let offsetWidthSpy: { mockRestore: () => void } | null = null
let offsetHeightSpy: { mockRestore: () => void } | null = null

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

const findEchartsHost = async () => {
  await waitFor(() => {
    expect(document.querySelector('.echarts-for-react')).toBeInTheDocument()
  })
  return document.querySelector('.echarts-for-react') as HTMLDivElement
}

const findEchartsInstance = async () => {
  const host = await findEchartsHost()
  await waitFor(() => {
    expect(echartsCjs.getInstanceByDom(host)).toBeTruthy()
  })
  return echartsCjs.getInstanceByDom(host)!
}

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTheme.mockReturnValue({ theme: Theme.light })
    clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
    clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    offsetWidthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
    offsetHeightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)

    const windowWithLegacyAudio = window as WindowWithLegacyAudio
    originalAudioContext = windowWithLegacyAudio.AudioContext
    originalWebkitAudioContext = windowWithLegacyAudio.webkitAudioContext
    windowWithLegacyAudio.AudioContext = MockAudioContext as unknown as AudioContextCtor
    windowWithLegacyAudio.webkitAudioContext = MockAudioContext as unknown as AudioContextCtor
    delete windowWithLegacyAudio.abcjsAudioContext
  })

  afterEach(() => {
    vi.useRealTimers()
    clientWidthSpy?.mockRestore()
    clientHeightSpy?.mockRestore()
    offsetWidthSpy?.mockRestore()
    offsetHeightSpy?.mockRestore()
    clientWidthSpy = null
    clientHeightSpy = null
    offsetWidthSpy = null
    offsetHeightSpy = null

    const windowWithLegacyAudio = window as WindowWithLegacyAudio
    if (originalAudioContext)
      windowWithLegacyAudio.AudioContext = originalAudioContext
    else
      delete windowWithLegacyAudio.AudioContext

    if (originalWebkitAudioContext)
      windowWithLegacyAudio.webkitAudioContext = originalWebkitAudioContext
    else
      delete windowWithLegacyAudio.webkitAudioContext

    delete windowWithLegacyAudio.abcjsAudioContext
    originalAudioContext = undefined
    originalWebkitAudioContext = undefined
  })

  // Base rendering behaviors for inline and language labels.
  describe('Rendering', () => {
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

    it('should render code element when className is not provided', () => {
      const { container } = render(<CodeBlock>plain text</CodeBlock>)

      expect(container.querySelector('code')?.textContent).toBe('plain text')
    })

    it('should render syntax-highlighted output when language is standard', () => {
      render(<CodeBlock className="language-javascript">const x = 1;</CodeBlock>)

      expect(screen.getByText('JavaScript')).toBeInTheDocument()
      expect(document.querySelector('code.language-javascript')?.textContent).toContain('const x = 1;')
    })

    it('should format unknown language labels with capitalized fallback when language is not in map', () => {
      render(<CodeBlock className="language-ruby">puts "ok"</CodeBlock>)

      expect(screen.getByText('Ruby')).toBeInTheDocument()
    })

    it('should render mermaid controls when language is mermaid', async () => {
      render(<CodeBlock className="language-mermaid">graph TB; A--&gt;B;</CodeBlock>)

      expect(await screen.findByText('app.mermaid.classic')).toBeInTheDocument()
      expect(screen.getByText('Mermaid')).toBeInTheDocument()
    })

    it('should render abc section header when language is abc', () => {
      render(<CodeBlock className="language-abc">X:1\nT:test</CodeBlock>)

      expect(screen.getByText('ABC')).toBeInTheDocument()
    })

    it('should hide svg renderer when toggle is clicked for svg language', async () => {
      const user = userEvent.setup()
      render(<CodeBlock className="language-svg">{'<svg/>'}</CodeBlock>)

      expect(await screen.findByText(/Error rendering SVG/i)).toBeInTheDocument()

      const svgToggleButton = screen.getAllByRole('button')[0]
      await user.click(svgToggleButton)

      expect(screen.queryByText(/Error rendering SVG/i)).not.toBeInTheDocument()
    })

    it('should render syntax-highlighted output when language is standard and app theme is dark', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark })

      render(<CodeBlock className="language-javascript">const y = 2;</CodeBlock>)

      expect(screen.getByText('JavaScript')).toBeInTheDocument()
      expect(document.querySelector('code.language-javascript')?.textContent).toContain('const y = 2;')
    })
  })

  // ECharts behaviors for loading, parsing, and chart lifecycle updates.
  describe('ECharts', () => {
    it('should show loading indicator when echarts content is empty', () => {
      render(<CodeBlock className="language-echarts"></CodeBlock>)

      expect(screen.getByText(/Chart loading.../i)).toBeInTheDocument()
    })

    it('should keep loading when echarts content is whitespace only', () => {
      render(<CodeBlock className="language-echarts">{'   '}</CodeBlock>)

      expect(screen.getByText(/Chart loading.../i)).toBeInTheDocument()
    })

    it('should render echarts with parsed option when JSON is valid', async () => {
      const option = { title: [{ text: 'Hello' }] }
      render(<CodeBlock className="language-echarts">{JSON.stringify(option)}</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
      expect(screen.queryByText(/Chart loading.../i)).not.toBeInTheDocument()
    })

    it('should use error option when echarts content is invalid but structurally complete', async () => {
      render(<CodeBlock className="language-echarts">{'{a:1}'}</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
      expect(screen.queryByText(/Chart loading.../i)).not.toBeInTheDocument()
    })

    it('should use error option when echarts content is invalid non-structured text', async () => {
      render(<CodeBlock className="language-echarts">{'not a json {'}</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
      expect(screen.queryByText(/Chart loading.../i)).not.toBeInTheDocument()
    })

    it('should keep loading when option is valid JSON but not an object', async () => {
      render(<CodeBlock className="language-echarts">"text-value"</CodeBlock>)

      expect(await screen.findByText(/Chart loading.../i)).toBeInTheDocument()
    })

    it('should keep loading when echarts content matches incomplete quote-pattern guard', async () => {
      render(<CodeBlock className="language-echarts">{'x{"a":1'}</CodeBlock>)

      expect(await screen.findByText(/Chart loading.../i)).toBeInTheDocument()
    })

    it('should keep loading when echarts content has unmatched opening array bracket', async () => {
      render(<CodeBlock className="language-echarts">[[1,2]</CodeBlock>)

      expect(await screen.findByText(/Chart loading.../i)).toBeInTheDocument()
    })

    it('should keep chart instance stable when window resize is triggered', async () => {
      render(<CodeBlock className="language-echarts">{'{}'}</CodeBlock>)

      await findEchartsHost()

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      expect(await findEchartsHost()).toBeInTheDocument()
    })

    it('should keep rendering when echarts content updates repeatedly', async () => {
      const { rerender } = render(<CodeBlock className="language-echarts">{'{"a":1}'}</CodeBlock>)
      await findEchartsHost()

      rerender(<CodeBlock className="language-echarts">{'{"a":2}'}</CodeBlock>)
      rerender(<CodeBlock className="language-echarts">{'{"a":3}'}</CodeBlock>)
      rerender(<CodeBlock className="language-echarts">{'{"a":4}'}</CodeBlock>)
      rerender(<CodeBlock className="language-echarts">{'{"a":5}'}</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
    })

    it('should stop processing extra finished events when chart finished callback fires repeatedly', async () => {
      render(<CodeBlock className="language-echarts">{'{"series":[]}'}</CodeBlock>)
      const chart = await findEchartsInstance()
      const chartWithTrigger = chart as unknown as { trigger?: (eventName: string, event?: unknown) => void }

      act(() => {
        for (let i = 0; i < 8; i++) {
          chartWithTrigger.trigger?.('finished', {})
          chart.resize()
        }
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
      })

      expect(await findEchartsHost()).toBeInTheDocument()
    })

    it('should switch from loading to chart when streaming content becomes valid JSON', async () => {
      const { rerender } = render(<CodeBlock className="language-echarts">{'{ "a":'}</CodeBlock>)
      expect(screen.getByText(/Chart loading.../i)).toBeInTheDocument()

      rerender(<CodeBlock className="language-echarts">{'{ "a": 1 }'}</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
    })

    it('should parse array JSON after previously incomplete streaming content', async () => {
      const parseSpy = vi.spyOn(JSON, 'parse')
      parseSpy.mockImplementationOnce(() => ({ series: [] }) as unknown as object)
      const { rerender } = render(<CodeBlock className="language-echarts">[1, 2</CodeBlock>)
      expect(screen.getByText(/Chart loading.../i)).toBeInTheDocument()

      rerender(<CodeBlock className="language-echarts">[1, 2]</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
      parseSpy.mockRestore()
    })

    it('should parse non-structured streaming content when JSON.parse fallback succeeds', async () => {
      const parseSpy = vi.spyOn(JSON, 'parse')
      parseSpy.mockImplementationOnce(() => ({ recovered: true }) as unknown as object)

      render(<CodeBlock className="language-echarts">abcde</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
      parseSpy.mockRestore()
    })

    it('should render dark themed echarts path when app theme is dark', async () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark })
      render(<CodeBlock className="language-echarts">{'{"series":[]}'}</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
    })

    it('should render dark mode error option when app theme is dark and echarts content is invalid', async () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark })
      render(<CodeBlock className="language-echarts">{'{a:1}'}</CodeBlock>)

      expect(await findEchartsHost()).toBeInTheDocument()
    })

    it('should wire resize listener when echarts view re-enters with a ready chart instance', async () => {
      const { rerender, unmount } = render(<CodeBlock className="language-echarts">{'{"a":1}'}</CodeBlock>)
      await findEchartsHost()

      rerender(<CodeBlock className="language-javascript">const x = 1;</CodeBlock>)
      rerender(<CodeBlock className="language-echarts">{'{"a":2}'}</CodeBlock>)

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      expect(await findEchartsHost()).toBeInTheDocument()
      unmount()
    })

    it('should cleanup echarts resize listener without pending timer on unmount', async () => {
      const { unmount } = render(<CodeBlock className="language-echarts">{'{"a":1}'}</CodeBlock>)
      await findEchartsHost()

      unmount()
    })
  })
})
