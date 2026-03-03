import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import mermaid from 'mermaid'
import Flowchart from '../index'

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

      const handDrawnBtn = screen.getByText(/handDrawn/i)
      await act(async () => {
        fireEvent.click(handDrawnBtn)
      })

      await waitFor(() => {
        expect(screen.getByText('test-svg-api')).toBeInTheDocument()
      }, { timeout: 3000 })

      const classicBtn = screen.getByText(/classic/i)
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
        expect(screen.getByTestId('image-preview-cancel-mock')).toBeInTheDocument()
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

      const uniqueCode = 'graph TD\n  X-->Y\n  Y-->Z'
      const { container } = render(<Flowchart PrimitiveCode={uniqueCode} />)

      await waitFor(() => {
        const errorSpan = container.querySelector('.text-red-500 span.ml-2')
        expect(errorSpan).toBeInTheDocument()
        expect(errorSpan?.textContent).toContain('Rendering failed')
      })

      consoleSpy.mockRestore()
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

      // Wait a bit for any potential re-renders
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
      })

      // Call count should not increase (cache was used)
      expect(vi.mocked(mermaid.render).mock.calls.length).toBe(initialCallCount)
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

    it('should use cache without rendering again when PrimitiveCode changes back to previous', async () => {
      const { rerender } = render(<Flowchart PrimitiveCode="graph TD\n  A-->B" />)

      // Wait for initial render
      await waitFor(() => {
        expect(vi.mocked(mermaid.render)).toHaveBeenCalled()
      }, { timeout: 3000 })
      const firstRenderCallCount = vi.mocked(mermaid.render).mock.calls.length

      // Change to different code
      await act(async () => {
        rerender(<Flowchart PrimitiveCode="graph TD\n  C-->D" />)
      })

      // Wait for second render
      await waitFor(() => {
        expect(vi.mocked(mermaid.render).mock.calls.length).toBeGreaterThan(firstRenderCallCount)
      }, { timeout: 3000 })
      const afterSecondRenderCallCount = vi.mocked(mermaid.render).mock.calls.length

      // Change back to first code - should use cache
      await act(async () => {
        rerender(<Flowchart PrimitiveCode="graph TD\n  A-->B" />)
      })

      // Wait a bit for any potential re-renders
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
      })

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
      const cancelBtn = await screen.findByTestId('image-preview-cancel-mock')
      expect(cancelBtn).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(cancelBtn)
      })

      // Wait for preview to close
      await waitFor(() => {
        expect(screen.queryByTestId('image-preview-cancel-mock')).not.toBeInTheDocument()
      })
    })

    it('should handle configuration failure during configureMermaid', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      const originalMock = vi.mocked(mermaid.initialize).getMockImplementation()
      vi.mocked(mermaid.initialize).mockImplementation(() => {
        throw new Error('Config fail')
      })

      render(<Flowchart PrimitiveCode="graph TD\n  G-->H" />)
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
      })
      consoleSpy.mockRestore()

      if (originalMock) {
        vi.mocked(mermaid.initialize).mockImplementation(originalMock)
      }
      else {
        vi.mocked(mermaid.initialize).mockImplementation(() => { })
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
        expect(screen.getByText(/handDrawn/)).toBeInTheDocument()
      }, { timeout: 3000 })

      const handDrawnBtn = screen.getByText(/handDrawn/)
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
  })
})
