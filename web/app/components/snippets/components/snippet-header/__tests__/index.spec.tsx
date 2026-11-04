import type { HeaderProps } from '@/app/components/workflow/header'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectLoadingButton } from '@/test/button'
import SnippetHeader from '..'

vi.mock('@/app/components/workflow/header', () => ({
  default: (props: HeaderProps) => {
    return (
      <div
        data-testid="workflow-header"
        data-show-env={String(props.normal?.controls?.showEnvButton ?? true)}
        data-show-global-variable={String(props.normal?.controls?.showGlobalVariableButton ?? true)}
        data-history-url={props.normal?.runAndHistoryProps?.viewHistoryProps?.historyUrl ?? ''}
      >
        {props.normal?.components?.title}
        {props.normal?.components?.left}
        <button type="button">
          {props.normal?.runAndHistoryProps?.runButtonText ?? 'snippet.testRunButton'}
        </button>
        {props.normal?.components?.middle}
      </div>
    )
  },
}))

describe('SnippetHeader', () => {
  const mockPublish = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('configures snippet-specific controls and publishes only while editable', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SnippetHeader
        snippetId="snippet-1"
        canSave
        canEdit
        isPublishing={false}
        onPublish={mockPublish}
      />,
    )

    const header = screen.getByTestId('workflow-header')
    expect(header).toHaveAttribute('data-show-env', 'false')
    expect(header).toHaveAttribute('data-show-global-variable', 'false')
    expect(header).toHaveAttribute('data-history-url', '/snippets/snippet-1/workflow-runs')
    await user.click(screen.getByRole('button', { name: /snippet\.publishButton/i }))
    expect(mockPublish).toHaveBeenCalledOnce()
    rerender(
      <SnippetHeader
        snippetId="snippet-1"
        canSave
        canEdit={false}
        isPublishing={false}
        onPublish={mockPublish}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /snippet\.publishButton/i }),
    ).not.toBeInTheDocument()
  })

  it('should disable publish when the current graph has no nodes', async () => {
    const user = userEvent.setup()
    render(
      <SnippetHeader
        snippetId="snippet-1"
        canSave={false}
        canEdit
        isPublishing={false}
        onPublish={mockPublish}
      />,
    )

    const publish = screen.getByRole('button', { name: /snippet\.publishButton/i })
    expect(publish).toBeDisabled()
    await user.click(publish)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('should show publish loading state while publishing', async () => {
    const user = userEvent.setup()
    render(
      <SnippetHeader snippetId="snippet-1" canSave canEdit isPublishing onPublish={mockPublish} />,
    )

    const publish = screen.getByRole('button', { name: /snippet\.publishButton/i })
    expectLoadingButton(publish)
    await user.click(publish)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
