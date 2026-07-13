import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchWorkflowInstructionSuggestions } from '@/service/workflow-generator'
import ExamplePrompts from '../example-prompts'

vi.mock('@/service/workflow-generator', () => ({
  fetchWorkflowInstructionSuggestions: vi.fn(),
}))

// ahooks' useSessionStorageState keeps an in-memory cache that survives
// sessionStorage.clear(), leaking suggestions across tests. Swap it for a plain
// useState so each mount starts cold and the mount-time fetch is deterministic.
vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  const React = await import('react')
  return {
    ...actual,
    useSessionStorageState: <T,>(key: string, options?: { defaultValue?: T }) => {
      const stored = sessionStorage.getItem(key)
      const initial = stored ? JSON.parse(stored) : options?.defaultValue
      return React.useState<T | undefined>(initial)
    },
  }
})

const mockFetch = vi.mocked(fetchWorkflowInstructionSuggestions)

describe('ExamplePrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Suggestions are session-cached per mode — clear so each test starts cold
    // and the mount-time fetch fires deterministically.
    sessionStorage.clear()
    // Safe default (empty → static fallback); tests override as needed. Avoids
    // any leftover mock implementation bleeding across tests.
    mockFetch.mockResolvedValue({ suggestions: [] })
  })

  describe('AI suggestions', () => {
    // The primary content is AI-generated, workspace-grounded chips fetched on
    // open; they replace the static list once they arrive.
    it('should render AI-generated chips when the backend returns suggestions', async () => {
      mockFetch.mockResolvedValue({ suggestions: ['Build a triage bot', 'Summarize PDFs'] })
      render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)

      expect(await screen.findByRole('button', { name: 'Build a triage bot' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Summarize PDFs' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /workflowGenerator\.examples\.workflow\.summarize/i }),
      ).not.toBeInTheDocument()
    })

    // Empty generation (no default model / quota) must silently fall back to the
    // curated static list so the row is never blank.
    it('should fall back to the static workflow list when generation returns nothing', async () => {
      mockFetch.mockResolvedValue({ suggestions: [] })
      render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)

      expect(
        await screen.findByRole('button', {
          name: /workflowGenerator\.examples\.workflow\.summarize/i,
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /workflowGenerator\.examples\.workflow\.translate/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /workflowGenerator\.examples\.workflow\.rag/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /workflowGenerator\.examples\.workflow\.classify/i }),
      ).toBeInTheDocument()
    })

    // Advanced-chat mode falls back to a different curated set with no workflow leakage.
    it('should fall back to the static chatflow list for advanced-chat mode', async () => {
      mockFetch.mockResolvedValue({ suggestions: [] })
      render(<ExamplePrompts mode="advanced-chat" onSelect={vi.fn()} />)

      expect(
        await screen.findByRole('button', {
          name: /workflowGenerator\.examples\.chatflow\.support/i,
        }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /workflowGenerator\.examples\.workflow\.summarize/i }),
      ).not.toBeInTheDocument()
    })

    // A failed request must not toast or blow up — it degrades to the static list.
    it('should silently fall back to the static list when generation throws', async () => {
      mockFetch.mockRejectedValue(new Error('boom'))
      render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)

      expect(
        await screen.findByRole('button', {
          name: /workflowGenerator\.examples\.workflow\.summarize/i,
        }),
      ).toBeInTheDocument()
    })

    it('should silently ignore AbortError when unmounted or refreshed', async () => {
      // Simulate fetch that we can manually abort
      mockFetch.mockImplementation(async (_, opts) => {
        return new Promise((resolve, reject) => {
          if (opts?.getAbortController) {
            const controller = new AbortController()
            opts.getAbortController(controller)
            controller.signal.addEventListener('abort', () => {
              const err = new Error('AbortError')
              err.name = 'AbortError'
              reject(err)
            })
          }
        })
      })

      const { unmount } = render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)
      // Unmount triggers abort
      unmount()

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should not fetch on mount if suggestions are already cached', async () => {
      // Simulate already having cached suggestions
      sessionStorage.setItem(
        'workflow-gen-suggestions-workflow',
        JSON.stringify(['cached suggestion']),
      )

      render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)

      expect(await screen.findByRole('button', { name: 'cached suggestion' })).toBeInTheDocument()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should gracefully handle empty response structure', async () => {
      // Simulate an empty response with no suggestions array
      // eslint-disable-next-line ts/no-explicit-any
      mockFetch.mockResolvedValue({} as any)
      render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)

      expect(
        await screen.findByRole('button', {
          name: /workflowGenerator\.examples\.workflow\.summarize/i,
        }),
      ).toBeInTheDocument()
    })

    it('does not double-fetch on re-renders (simulating React Strict Mode)', async () => {
      mockFetch.mockResolvedValue({ suggestions: ['test double-fetch'] })
      const { rerender, unmount } = render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)

      // Re-render the same component instance with a new prop to trigger the effect again
      rerender(<ExamplePrompts mode="advanced-chat" onSelect={vi.fn()} />)

      await screen.findByRole('button', { name: 'test double-fetch' })
      expect(mockFetch).toHaveBeenCalledTimes(1) // Only fetched once because didInit.current is true

      unmount()
    })
  })

  describe('refresh', () => {
    // The ↻ control pulls a fresh set — the whole point of "more ideas".
    it('should refetch a fresh set when the refresh control is clicked', async () => {
      mockFetch.mockResolvedValue({ suggestions: ['first set'] })
      const user = userEvent.setup()
      render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)
      await screen.findByRole('button', { name: 'first set' })
      expect(mockFetch).toHaveBeenCalledTimes(1)

      mockFetch.mockResolvedValue({ suggestions: ['second set'] })
      await user.click(
        screen.getByRole('button', { name: /workflowGenerator\.examples\.refresh/i }),
      )

      expect(await screen.findByRole('button', { name: 'second set' })).toBeInTheDocument()
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('selection', () => {
    // Clicking a chip hands its text back to the parent verbatim to populate
    // the instruction textarea.
    it("should forward the clicked chip's text to onSelect", async () => {
      mockFetch.mockResolvedValue({ suggestions: ['Build a triage bot'] })
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(<ExamplePrompts mode="workflow" onSelect={onSelect} />)

      const chip = await screen.findByRole('button', { name: 'Build a triage bot' })
      await user.click(chip)

      expect(onSelect).toHaveBeenCalledWith('Build a triage bot')
    })
  })
})
