import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExamplePrompts from '../example-prompts'

describe('ExamplePrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    // Workflow mode surfaces a curated 4-prompt set; the count matters
    // because the chip row's wrap behaviour was tuned for ≤ 4 entries.
    it('should render the 4 workflow-mode prompts', () => {
      render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)

      expect(screen.getAllByRole('button')).toHaveLength(4)
      expect(screen.getByRole('button', { name: /workflowGenerator\.examples\.workflow\.summarize/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflowGenerator\.examples\.workflow\.translate/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflowGenerator\.examples\.workflow\.rag/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflowGenerator\.examples\.workflow\.classify/i })).toBeInTheDocument()
    })

    // Advanced-chat mode surfaces a different (3-prompt) set tailored to
    // chatflow patterns. None of the workflow prompts should leak through.
    it('should render the 3 chatflow-mode prompts when mode is advanced-chat', () => {
      render(<ExamplePrompts mode="advanced-chat" onSelect={vi.fn()} />)

      expect(screen.getAllByRole('button')).toHaveLength(3)
      expect(screen.getByRole('button', { name: /workflowGenerator\.examples\.chatflow\.support/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /workflowGenerator\.examples\.workflow\.summarize/i })).not.toBeInTheDocument()
    })

    // The "Try one of these" label anchors the row visually; missing it
    // would degrade the section to anonymous chips.
    it('should render a section label above the chips', () => {
      render(<ExamplePrompts mode="workflow" onSelect={vi.fn()} />)
      expect(screen.getByText(/workflowGenerator\.examples\.label/i)).toBeInTheDocument()
    })
  })

  describe('selection', () => {
    // Clicking a chip is the whole point of the component — it must hand
    // the chip text back to the parent verbatim so the parent can populate
    // the instruction textarea.
    it('should forward the clicked chip\'s text to onSelect', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(<ExamplePrompts mode="workflow" onSelect={onSelect} />)

      const chip = screen.getByRole('button', { name: /workflowGenerator\.examples\.workflow\.summarize/i })
      await user.click(chip)

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect.mock.calls[0]![0]).toMatch(/workflowGenerator\.examples\.workflow\.summarize/i)
    })
  })
})
