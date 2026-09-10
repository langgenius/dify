import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SuggestedAction from '../suggested-action'

describe('SuggestedAction', () => {
  it('should render an enabled external link with supporting copy', () => {
    render(
      <SuggestedAction
        link="https://example.com/docs"
        external
        description="Read the documentation"
      >
        Open docs
      </SuggestedAction>,
    )

    const link = screen.getByRole('link', { name: 'Open docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAccessibleDescription('Read the documentation')
    expect(screen.getByText('Read the documentation')).toBeInTheDocument()
  })

  it('should render internal destinations without opening a new tab', () => {
    render(
      <SuggestedAction link="/app/app-1/deploy" description="Push versions to environments">
        Deploy
      </SuggestedAction>,
    )

    const link = screen.getByRole('link', { name: 'Deploy' })
    expect(link).toHaveAttribute('href', '/app/app-1/deploy')
    expect(link).not.toHaveAttribute('target')
    expect(link).toHaveAccessibleDescription('Push versions to environments')
  })

  it('should use native disabled button semantics for unavailable links', () => {
    const handleClick = vi.fn()

    render(
      <SuggestedAction
        link="https://example.com/docs"
        disabled
        description="Unavailable until published"
        onClick={handleClick}
      >
        Disabled action
      </SuggestedAction>,
    )

    const action = screen.getByRole('button', { name: 'Disabled action' })
    fireEvent.click(action)

    expect(action).toBeDisabled()
    expect(screen.queryByRole('link', { name: /Disabled action/ })).not.toBeInTheDocument()
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('should keep an explained disabled action in the keyboard tab order', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()

    render(
      <SuggestedAction disabled focusableWhenDisabled onClick={handleClick}>
        Disabled action with explanation
      </SuggestedAction>,
    )

    await user.tab()

    const action = screen.getByRole('button', { name: 'Disabled action with explanation' })
    expect(action).toHaveFocus()
    expect(action).toHaveAttribute('aria-disabled', 'true')

    await user.keyboard('{Enter}')
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('should render and trigger an enabled button action', () => {
    const handleClick = vi.fn()

    render(
      <SuggestedAction description="Use as a tool in other apps" onClick={handleClick}>
        Workflow as Tool
      </SuggestedAction>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Workflow as Tool' }))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('should keep the main link separate from a trailing action button', () => {
    const handleActionClick = vi.fn()

    render(
      <SuggestedAction
        link="https://example.com/app"
        external
        actionButton={{
          ariaLabel: 'Configure action',
          icon: <span>config</span>,
          onClick: handleActionClick,
        }}
      >
        Open web app
      </SuggestedAction>,
    )

    expect(screen.getByRole('link', { name: 'Open web app' })).toHaveAttribute(
      'href',
      'https://example.com/app',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Configure action' }))
    expect(handleActionClick).toHaveBeenCalledTimes(1)
  })

  it('should disable both controls when an action with a trailing button is unavailable', () => {
    const handleActionClick = vi.fn()

    render(
      <SuggestedAction
        link="https://example.com/app"
        external
        disabled
        actionButton={{
          ariaLabel: 'Configure action',
          icon: <span>config</span>,
          onClick: handleActionClick,
        }}
      >
        Open web app
      </SuggestedAction>,
    )

    expect(screen.getByRole('button', { name: 'Open web app' })).toBeDisabled()

    const actionButton = screen.getByRole('button', { name: 'Configure action' })
    fireEvent.click(actionButton)
    expect(actionButton).toBeDisabled()
    expect(handleActionClick).not.toHaveBeenCalled()
  })
})
