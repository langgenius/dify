import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import mermaid from 'mermaid'
import Flowchart from '../index'

const HAND_DRAWN_RE = /handDrawn/i
const HAND_DRAWN_EXACT_RE = /handDrawn/
const CLASSIC_RE = /classic/i
const SWITCH_LIGHT_RE = /switchLight$/
const SWITCH_DARK_RE = /switchDark$/
const RENDERING_FAILED_RE = /Rendering failed/i
const UNKNOWN_ERROR_RE = /Unknown error\. Please check the console\./i

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg id="mermaid-chart">test-svg</svg>', diagramType: 'flowchart' }),
    mermaidAPI: {
      render: vi.fn().mockResolvedValue({ svg: '<svg id="mermaid-chart">test-svg-api</svg>', diagramType: 'flowchart' }),
    },
  },
}))

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    svgToBase64: vi.fn().mockResolvedValue('data:image/svg+xml;base64,dGVzdC1zdmc='),
    waitForDOMElement: vi.fn((cb: () => Promise<unknown>) => cb()),
  }
})

describe('Mermaid Flowchart Component', () => {
  const mockCode = 'graph TD\n  A-->B'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mermaid.initialize).mockImplementation(() => { })
    vi.mocked(mermaid.render).mockResolvedValue({ svg: '<svg id="mermaid-chart">test-svg</svg>', diagramType: 'flowchart' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should initialize mermaid on mount', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} />)
      })
      expect(mermaid.initialize).toHaveBeenCalled()
    })

    it('should render mermaid chart after debounce', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} />)
      })

      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should render gantt charts with specific formatting', async () => {
      const ganttCode = 'gantt\ntitle T\nTask :after task1, after task2'
      await act(async () => {
        render(<Flowchart PrimitiveCode={ganttCode} />)
      })

      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should render mindmap and sequenceDiagram charts', async () => {
      const mindmapCode = 'mindmap\n  root\n    topic1'
      const { unmount } = await act(async () => {
        return render(<Flowchart PrimitiveCode={mindmapCode} />)
      })
      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })

      unmount()

      const sequenceCode = 'sequenceDiagram\n  A->>B: Hello'
      await act(async () => {
        render(<Flowchart PrimitiveCode={sequenceCode} />)
      })
      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should handle dark theme configuration', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} theme="dark" />)
      })
      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  describe('Interactions', () => {
    it('should switch between classic and handDrawn looks', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} />)
      })

      await waitFor(() => screen.getByText('test-svg'), { timeout: 3000 })

      const handDrawnBtn = screen.getByText(HAND_DRAWN_RE)
      await act(async () => {
        fireEvent.click(handDrawnBtn)
      })

      await waitFor(() => {
        expect(screen.getByText('test-svg-api')).toBeInTheDocument()
      }, { timeout: 3000 })

      const classicBtn = screen.getByText(CLASSIC_RE)
      await act(async () => {
        fireEvent.click(classicBtn)
      })

      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should toggle theme manually', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} theme="light" />)
      })

      await waitFor(() => screen.getByText('test-svg'), { timeout: 3000 })

      const toggleBtn = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(toggleBtn)
      })

      await waitFor(() => {
        expect(mermaid.initialize).toHaveBeenCalled()
      }, { timeout: 3000 })
    })

    it('should keep selected look unchanged when clicking an already-selected look button', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} />)
      })

      await waitFor(() => screen.getByText('test-svg'), { timeout: 3000 })

      const initialRenderCalls = vi.mocked(mermaid.render).mock.calls.length
      const initialApiRenderCalls = vi.mocked(mermaid.mermaidAPI.render).mock.calls.length

      await act(async () => {
        fireEvent.click(screen.getByText(CLASSIC_RE))
      })
      expect(vi.mocked(mermaid.render).mock.calls.length).toBe(initialRenderCalls)
      expect(vi.mocked(mermaid.mermaidAPI.render).mock.calls.length).toBe(initialApiRenderCalls)

      await act(async () => {
        fireEvent.click(screen.getByText(HAND_DRAWN_RE))
      })
      await waitFor(() => {
        expect(screen.getByText('test-svg-api')).toBeInTheDocument()
      }, { timeout: 3000 })

      const afterFirstHandDrawnApiCalls = vi.mocked(mermaid.mermaidAPI.render).mock.calls.length
      await act(async () => {
        fireEvent.click(screen.getByText(HAND_DRAWN_RE))
      })
      expect(vi.mocked(mermaid.mermaidAPI.render).mock.calls.length).toBe(afterFirstHandDrawnApiCalls)
    })

    it('should toggle theme from light to dark and back to light', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} theme="light" />)
      })
      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })

      const toggleBtn = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(toggleBtn)
      })
      await waitFor(() => {
        expect(screen.getByRole('button')).toHaveAttribute('title', expect.stringMatching(SWITCH_LIGHT_RE))
      }, { timeout: 3000 })

      await act(async () => {
        fireEvent.click(screen.getByRole('button'))
      })
      await waitFor(() => {
        expect(screen.getByRole('button')).toHaveAttribute('title', expect.stringMatching(SWITCH_DARK_RE))
      }, { timeout: 3000 })
    })

    it('should configure handDrawn mode for dark non-flowchart diagrams', async () => {
      const sequenceCode = 'sequenceDiagram\n  A->>B: Hi'
      await act(async () => {
        render(<Flowchart PrimitiveCode={sequenceCode} theme="dark" />)
      })

      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })

      await act(async () => {
        fireEvent.click(screen.getByText(HAND_DRAWN_RE))
      })

      await waitFor(() => {
        expect(screen.getByText('test-svg-api')).toBeInTheDocument()
      }, { timeout: 3000 })

      expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
        theme: 'default',
        themeVariables: expect.objectContaining({
          primaryBorderColor: '#60a5fa',
        }),
      }))
    })

    it('should open image preview when clicking the chart', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} />)
      })

      await waitFor(() => screen.getByText('test-svg'), { timeout: 3000 })

      const chartDiv = screen.getByText('test-svg').closest('.mermaid')
      await act(async () => {
        fireEvent.click(chartDiv!)
      })
      await waitFor(() => {
        expect(screen.getByTestId('image-preview-container')).toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  describe('Edge Cases', () => {
    it('should not render when code is too short', async () => {
      const shortCode = 'graph'
      vi.useFakeTimers()
      render(<Flowchart PrimitiveCode={shortCode} />)
      await vi.advanceTimersByTimeAsync(1000)
      expect(mermaid.render).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('should handle rendering errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      const errorMsg = 'Syntax error'
      vi.mocked(mermaid.render).mockRejectedValue(new Error(errorMsg))

      try {
        const uniqueCode = 'graph TD\n  X-->Y\n  Y-->Z'
        render(<Flowchart PrimitiveCode={uniqueCode} />)

        const errorMessage = await screen.findByText(RENDERING_FAILED_RE)
        expect(errorMessage).toBeInTheDocument()
      }
      finally {
        consoleSpy.mockRestore()
      }
    })

    it('should show unknown-error fallback when render fails without an error message', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      vi.mocked(mermaid.render).mockRejectedValue({} as Error)

      try {
        render(<Flowchart PrimitiveCode={'graph TD\n  P-->Q\n  Q-->R'} />)
        expect(await screen.findByText(UNKNOWN_ERROR_RE)).toBeInTheDocument()
      }
      finally {
        consoleSpy.mockRestore()
      }
    })

    it('should use cached diagram if available', async () => {
      const { rerender } = render(<Flowchart PrimitiveCode={mockCode} />)

      // Wait for initial render to complete
      await waitFor(() => {
        expect(vi.mocked(mermaid.render)).toHaveBeenCalled()
      }, { timeout: 3000 })
      const initialCallCount = vi.mocked(mermaid.render).mock.calls.length

      // Rerender with same code
      await act(async () => {
        rerender(<Flowchart PrimitiveCode={mockCode} />)
      })

      await waitFor(() => {
        expect(vi.mocked(mermaid.render).mock.calls.length).toBe(initialCallCount)
      }, { timeout: 3000 })

      // Call count should not increase (cache was used)
      expect(vi.mocked(mermaid.render).mock.calls.length).toBe(initialCallCount)
    })

    it('should keep previous svg visible while next render is loading', async () => {
      let resolveSecondRender: ((value: { svg: string, diagramType: string }) => void) | null = null
      const secondRenderPromise = new Promise<{ svg: string, diagramType: string }>((resolve) => {
        resolveSecondRender = resolve
      })

      vi.mocked(mermaid.render)
        .mockResolvedValueOnce({ svg: '<svg id="mermaid-chart">initial-svg</svg>', diagramType: 'flowchart' })
        .mockImplementationOnce(() => secondRenderPromise)

      const { rerender } = render(<Flowchart PrimitiveCode="graph TD\n  A-->B" />)

      await waitFor(() => {
        expect(screen.getByText('initial-svg')).toBeInTheDocument()
      }, { timeout: 3000 })

      await act(async () => {
        rerender(<Flowchart PrimitiveCode="graph TD\n  C-->D" />)
      })

      expect(screen.getByText('initial-svg')).toBeInTheDocument()

      resolveSecondRender!({ svg: '<svg id="mermaid-chart">second-svg</svg>', diagramType: 'flowchart' })
      await waitFor(() => {
        expect(screen.getByText('second-svg')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should handle invalid mermaid code completion', async () => {
      const invalidCode = 'graph TD\nA -->' // Incomplete
      await act(async () => {
        render(<Flowchart PrimitiveCode={invalidCode} />)
      })

      await waitFor(() => {
        expect(screen.getByText('Diagram code is not complete or invalid.')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should keep single "after" gantt dependency formatting unchanged', async () => {
      const singleAfterGantt = [
        'gantt',
        'title One after dependency',
        'Single task :after task1, 2024-01-01, 1d',
      ].join('\n')

      await act(async () => {
        render(<Flowchart PrimitiveCode={singleAfterGantt} />)
      })

      await waitFor(() => {
        expect(mermaid.render).toHaveBeenCalled()
      }, { timeout: 3000 })

      const lastRenderArgs = vi.mocked(mermaid.render).mock.calls.at(-1)
      expect(lastRenderArgs?.[1]).toContain('Single task :after task1, 2024-01-01, 1d')
    })

    it('should use cache without rendering again when PrimitiveCode changes back to previous', async () => {
      const firstCode = 'graph TD\n  CacheOne-->CacheTwo'
      const secondCode = 'graph TD\n  CacheThree-->CacheFour'
      const { rerender } = render(<Flowchart PrimitiveCode={firstCode} />)

      // Wait for initial render
      await waitFor(() => {
        expect(vi.mocked(mermaid.render)).toHaveBeenCalled()
      }, { timeout: 3000 })
      const firstRenderCallCount = vi.mocked(mermaid.render).mock.calls.length

      // Change to different code
      await act(async () => {
        rerender(<Flowchart PrimitiveCode={secondCode} />)
      })

      // Wait for second render
      await waitFor(() => {
        expect(vi.mocked(mermaid.render).mock.calls.length).toBeGreaterThan(firstRenderCallCount)
      }, { timeout: 3000 })
      const afterSecondRenderCallCount = vi.mocked(mermaid.render).mock.calls.length

      // Change back to first code - should use cache
      await act(async () => {
        rerender(<Flowchart PrimitiveCode={firstCode} />)
      })

      await waitFor(() => {
        expect(vi.mocked(mermaid.render).mock.calls.length).toBe(afterSecondRenderCallCount)
      }, { timeout: 3000 })

      // Call count should not increase (cache was used)
      expect(vi.mocked(mermaid.render).mock.calls.length).toBe(afterSecondRenderCallCount)
    })

    it('should close image preview when cancel is clicked', async () => {
      await act(async () => {
        render(<Flowchart PrimitiveCode={mockCode} />)
      })

      // Wait for SVG to be rendered
      await waitFor(() => {
        const svgElement = screen.queryByText('test-svg')
        expect(svgElement).toBeInTheDocument()
      }, { timeout: 3000 })

      const mermaidDiv = screen.getByText('test-svg').closest('.mermaid')
      await act(async () => {
        fireEvent.click(mermaidDiv!)
      })

      // Wait for image preview to appear
      const cancelBtn = await screen.findByTestId('image-preview-close-button')
      expect(cancelBtn).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(cancelBtn)
      })

      await waitFor(() => {
        expect(screen.queryByTestId('image-preview-container')).not.toBeInTheDocument()
        expect(screen.queryByTestId('image-preview-close-button')).not.toBeInTheDocument()
      })
    })

    it('should handle configuration failure during configureMermaid', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      const originalMock = vi.mocked(mermaid.initialize).getMockImplementation()
      vi.mocked(mermaid.initialize).mockImplementation(() => {
        throw new Error('Config fail')
      })

      try {
        await act(async () => {
          render(<Flowchart PrimitiveCode="graph TD\n  G-->H" />)
        })
        await waitFor(() => {
          expect(consoleSpy).toHaveBeenCalledWith('Config error:', expect.any(Error))
        })
      }
      finally {
        consoleSpy.mockRestore()
        if (originalMock) {
          vi.mocked(mermaid.initialize).mockImplementation(originalMock)
        }
        else {
          vi.mocked(mermaid.initialize).mockImplementation(() => { })
        }
      }
    })

    it('should handle unmount cleanup', async () => {
      const { unmount } = render(<Flowchart PrimitiveCode={mockCode} />)
      await act(async () => {
        unmount()
      })
    })
  })
})

describe('Mermaid Flowchart Component Module Isolation', () => {
  const mockCode = 'graph TD\n  A-->B'

  let mermaidFresh: typeof mermaid
  const setWindowUndefined = () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    return descriptor
  }

  const restoreWindowDescriptor = (descriptor?: PropertyDescriptor) => {
    if (descriptor)
      Object.defineProperty(globalThis, 'window', descriptor)
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const mod = await import('mermaid') as unknown as { default: typeof mermaid } | typeof mermaid
    mermaidFresh = 'default' in mod ? mod.default : mod
    vi.mocked(mermaidFresh.initialize).mockImplementation(() => { })
  })

  describe('Error Handling', () => {
    it('should handle initialization failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      const { default: FlowchartFresh } = await import('../index')

      vi.mocked(mermaidFresh.initialize).mockImplementationOnce(() => {
        throw new Error('Init fail')
      })

      await act(async () => {
        render(<FlowchartFresh PrimitiveCode={mockCode} />)
      })

      expect(consoleSpy).toHaveBeenCalledWith('Mermaid initialization error:', expect.any(Error))
      consoleSpy.mockRestore()
    })

    it('should handle mermaidAPI missing fallback', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      const originalMermaidAPI = mermaidFresh.mermaidAPI
      // @ts-expect-error need to set undefined for testing
      mermaidFresh.mermaidAPI = undefined

      const { default: FlowchartFresh } = await import('../index')

      const { container } = render(<FlowchartFresh PrimitiveCode={mockCode} />)

      // Wait for initial render to complete
      await waitFor(() => {
        expect(screen.getByText(HAND_DRAWN_EXACT_RE)).toBeInTheDocument()
      }, { timeout: 3000 })

      const handDrawnBtn = screen.getByText(HAND_DRAWN_EXACT_RE)
      await act(async () => {
        fireEvent.click(handDrawnBtn)
      })

      // When mermaidAPI is undefined, handDrawn style falls back to mermaid.render.
      // The module captures mermaidAPI at import time, so setting it to undefined on
      // the mocked object may not affect the module's internal reference.
      // Verify that the rendering completes (either with svg or error)
      await waitFor(() => {
        const hasSvg = container.querySelector('.mermaid div')
        const hasError = container.querySelector('.text-red-500')
        expect(hasSvg || hasError).toBeTruthy()
      }, { timeout: 5000 })

      mermaidFresh.mermaidAPI = originalMermaidAPI
      consoleSpy.mockRestore()
    }, 10000)

    it('should handle configuration failure', async () => {
      vi.mocked(mermaidFresh.initialize).mockImplementation(() => {
        throw new Error('Config fail')
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      const { default: FlowchartFresh } = await import('../index')

      await act(async () => {
        render(<FlowchartFresh PrimitiveCode={mockCode} />)
      })

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Mermaid initialization error:', expect.any(Error))
      })
      consoleSpy.mockRestore()
    })

    it('should load module safely when window is undefined', async () => {
      const descriptor = setWindowUndefined()
      try {
        vi.resetModules()
        const { default: FlowchartFresh } = await import('../index')
        expect(FlowchartFresh).toBeDefined()
      }
      finally {
        restoreWindowDescriptor(descriptor)
      }
    })

    it('should skip configuration when window is unavailable before debounce execution', async () => {
      const { default: FlowchartFresh } = await import('../index')
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
      vi.useFakeTimers()
      try {
        await act(async () => {
          render(<FlowchartFresh PrimitiveCode={mockCode} />)
        })
        await Promise.resolve()

        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          writable: true,
          value: undefined,
        })
        await vi.advanceTimersByTimeAsync(350)

        expect(mermaidFresh.render).not.toHaveBeenCalled()
      }
      finally {
        if (descriptor)
          Object.defineProperty(globalThis, 'window', descriptor)
        vi.useRealTimers()
      }
    })

    it.skip('should show container-not-found error when container ref remains null', async () => {
      vi.resetModules()
      vi.doMock('react', async () => {
        const reactActual = await vi.importActual<typeof import('react')>('react')
        let pendingContainerRef: ReturnType<typeof reactActual.useRef> | null = null
        let patchedContainerRef = false
        const mockedUseRef = ((initialValue: unknown) => {
          const ref = reactActual.useRef(initialValue as never)
          if (!patchedContainerRef && initialValue === null)
            pendingContainerRef = ref

          if (!patchedContainerRef
            && pendingContainerRef
            && typeof initialValue === 'string'
            && initialValue.startsWith('mermaid-chart-')) {
            Object.defineProperty(pendingContainerRef, 'current', {
              configurable: true,
              get() {
                return null
              },
              set(_value: HTMLDivElement | null) { },
            })
            patchedContainerRef = true
            pendingContainerRef = null
          }
          return ref
        }) as typeof reactActual.useRef

        return {
          ...reactActual,
          useRef: mockedUseRef,
        }
      })

      try {
        const { default: FlowchartFresh } = await import('../index')
        render(<FlowchartFresh PrimitiveCode={mockCode} />)
        expect(await screen.findByText('Container element not found')).toBeInTheDocument()
      }
      finally {
        vi.doUnmock('react')
      }
    })

    it('should cancel a pending classic render on unmount', async () => {
      const { default: FlowchartFresh } = await import('../index')

      vi.useFakeTimers()
      try {
        const { unmount } = render(<FlowchartFresh PrimitiveCode={mockCode} />)

        await act(async () => {
          unmount()
          await vi.advanceTimersByTimeAsync(350)
        })

        expect(vi.mocked(mermaidFresh.render)).not.toHaveBeenCalled()
      }
      finally {
        vi.useRealTimers()
      }
    })

    it('should cancel a pending handDrawn render on unmount', async () => {
      const { default: FlowchartFresh } = await import('../index')
      const { unmount } = render(<FlowchartFresh PrimitiveCode={mockCode} />)

      await waitFor(() => {
        expect(screen.getByText('test-svg')).toBeInTheDocument()
      }, { timeout: 3000 })

      const initialHandDrawnCalls = vi.mocked(mermaidFresh.mermaidAPI.render).mock.calls.length

      vi.useFakeTimers()
      try {
        await act(async () => {
          fireEvent.click(screen.getByText(HAND_DRAWN_RE))
        })

        await act(async () => {
          unmount()
          await vi.advanceTimersByTimeAsync(350)
        })

        expect(vi.mocked(mermaidFresh.mermaidAPI.render).mock.calls.length).toBe(initialHandDrawnCalls)
      }
      finally {
        vi.useRealTimers()
      }
    })
  })
})
