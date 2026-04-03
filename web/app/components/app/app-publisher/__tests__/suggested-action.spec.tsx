import type { MouseEvent as ReactMouseEvent } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import SuggestedAction from '../suggested-action'

describe('SuggestedAction', () => {
  it('should render an enabled external link', () => {
    render(
      <SuggestedAction link="https://example.com/docs">
        Open docs
      </SuggestedAction>,
    )

    const link = screen.getByRole('link', { name: 'Open docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('should block clicks when disabled', () => {
    const handleClick = vi.fn()

    render(
      <SuggestedAction link="https://example.com/docs" disabled onClick={handleClick}>
        Disabled action
      </SuggestedAction>,
    )

    const link = screen.getByText('Disabled action').closest('a') as HTMLAnchorElement
    fireEvent.click(link)

    expect(link).not.toHaveAttribute('href')
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('should forward click events when enabled', () => {
    const handleClick = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
    })

    render(
      <SuggestedAction link="https://example.com/docs" onClick={handleClick}>
        Enabled action
      </SuggestedAction>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Enabled action' }))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
