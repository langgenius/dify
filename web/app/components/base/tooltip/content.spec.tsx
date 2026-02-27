import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToolTipContent } from './content'

describe('ToolTipContent', () => {
  it('should render children correctly', () => {
    render(
      <ToolTipContent>
        <span>Tooltip body text</span>
      </ToolTipContent>,
    )
    expect(screen.getByTestId('tooltip-content')).toBeInTheDocument()
    expect(screen.getByTestId('tooltip-content-body')).toHaveTextContent('Tooltip body text')
    expect(screen.queryByTestId('tooltip-content-title')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tooltip-content-action')).not.toBeInTheDocument()
  })

  it('should render title when provided', () => {
    render(
      <ToolTipContent title="Tooltip Title">
        <span>Tooltip body text</span>
      </ToolTipContent>,
    )
    expect(screen.getByTestId('tooltip-content-title')).toHaveTextContent('Tooltip Title')
  })

  it('should render action when provided', () => {
    render(
      <ToolTipContent action={<span>Action Text</span>}>
        <span>Tooltip body text</span>
      </ToolTipContent>,
    )
    expect(screen.getByTestId('tooltip-content-action')).toHaveTextContent('Action Text')
  })

  it('should handle action click', async () => {
    const user = userEvent.setup()
    const handleActionClick = vi.fn()
    render(
      <ToolTipContent action={<span onClick={handleActionClick}>Action Text</span>}>
        <span>Tooltip body text</span>
      </ToolTipContent>,
    )

    await user.click(screen.getByText('Action Text'))
    expect(handleActionClick).toHaveBeenCalledTimes(1)
  })
})
