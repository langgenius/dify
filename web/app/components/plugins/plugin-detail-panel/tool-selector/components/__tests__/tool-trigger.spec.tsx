import type { ToolWithProvider } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ToolTrigger from '../tool-trigger'

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
})
