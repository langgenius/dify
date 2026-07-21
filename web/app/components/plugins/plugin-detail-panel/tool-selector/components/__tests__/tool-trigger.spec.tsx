import type { ToolWithProvider } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ToolTrigger } from '../tool-trigger'

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon" />,
}))

describe('ToolTrigger', () => {
  it('renders the placeholder for the unconfigured state', () => {
    render(<ToolTrigger open={false} />)

    expect(screen.getByText('plugin.detailPanel.toolSelector.placeholder')).toBeInTheDocument()
  })

  it('renders the selected provider icon and tool label', () => {
    render(
      <ToolTrigger
        open
        provider={{ icon: 'tool-icon' } as ToolWithProvider}
        value={{
          provider_name: 'provider-a',
          tool_name: 'Search Tool',
        }}
      />,
    )

    expect(screen.getByTestId('block-icon')).toBeInTheDocument()
    expect(screen.getByText('Search Tool')).toBeInTheDocument()
  })

  it('switches to the configure placeholder when requested', () => {
    render(<ToolTrigger open={false} isConfigure />)

    expect(screen.getByText('plugin.detailPanel.configureTool')).toBeInTheDocument()
  })

  it('forwards trigger attributes, events, and the anchor ref to the button', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()

    render(
      <ToolTrigger
        ref={ref}
        open={false}
        aria-haspopup="dialog"
        aria-expanded={false}
        onClick={onClick}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'plugin.detailPanel.toolSelector.placeholder',
    })
    expect(ref.current).toBe(trigger)
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
