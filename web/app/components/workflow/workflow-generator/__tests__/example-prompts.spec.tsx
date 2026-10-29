import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { fetchWorkflowInstructionSuggestions } from '@/service/workflow-generator'
import ExamplePrompts from '../example-prompts'

vi.mock('@/service/workflow-generator', () => ({
  fetchWorkflowInstructionSuggestions: vi.fn(),
}))

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
      const user = userEvent.setup()
      const onSelect = vi.fn()
      mockFetch.mockResolvedValue({ suggestions: [' Build a triage bot ', '', 'Summarize PDFs'] })
      render(<ExamplePrompts mode="workflow" onSelect={onSelect} />)

      expect(await screen.findByRole('button', { name: 'Build a triage bot' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Build a triage bot' }))
      expect(onSelect).toHaveBeenCalledWith('Build a triage bot')
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
  })

  it('restarts a canceled Strict Mode request and ignores its late response', async () => {
    const requests: {
      controller: AbortController
      resolve: (value: { suggestions: string[] }) => void
    }[] = []
    mockFetch.mockImplementation(
      (_, options) =>
        new Promise((resolve) => {
          const controller = new AbortController()
          options?.getAbortController?.(controller)
          requests.push({ controller, resolve })
        }),
    )
    const { unmount } = render(
      <StrictMode>
        <ExamplePrompts mode="workflow" onSelect={vi.fn()} />
      </StrictMode>,
    )
    expect(requests).toHaveLength(2)
    expect(requests[0]!.controller.signal.aborted).toBe(true)
    expect(requests[1]!.controller.signal.aborted).toBe(false)

    await act(async () => requests[0]!.resolve({ suggestions: ['stale suggestion'] }))
    expect(screen.getByRole('button', { name: /examples.refresh/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'stale suggestion' })).not.toBeInTheDocument()
    await act(async () => requests[1]!.resolve({ suggestions: ['current suggestion'] }))
    expect(screen.getByRole('button', { name: 'current suggestion' })).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('workflow-gen-suggestions-workflow')!)).toEqual([
      'current suggestion',
    ])
    unmount()
  })

  it('aborts an in-flight request on unmount', () => {
    const controller = new AbortController()
    mockFetch.mockImplementation(
      (_, options) =>
        new Promise((_resolve, reject) => {
          options?.getAbortController?.(controller)
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    const { unmount } = render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)
    unmount()
    expect(controller.signal.aborted).toBe(true)
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
})
