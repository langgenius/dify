import type { HeaderProps } from '@/app/components/workflow/header'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('should configure workflow header slots and hide workflow-only controls', () => {
    render(
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
    expect(screen.getByRole('button', { name: /snippet\.publishButton/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /snippet\.testRunButton/i })).toBeInTheDocument()
    expect(screen.queryByText('snippet.viewOnly')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snippet\.edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snippet\.exitEditing/i })).not.toBeInTheDocument()
  })

  it('should publish from the primary header action', () => {
    render(
      <SnippetHeader
        snippetId="snippet-1"
        canSave
        canEdit
        isPublishing={false}
        onPublish={mockPublish}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /snippet\.publishButton/i }))

    expect(mockPublish).toHaveBeenCalledTimes(1)
  })

  it('should disable publish when the current graph has no nodes', () => {
    render(
      <SnippetHeader
        snippetId="snippet-1"
        canSave={false}
        canEdit
        isPublishing={false}
        onPublish={mockPublish}
      />,
    )

    expect(screen.getByRole('button', { name: /snippet\.publishButton/i })).toBeDisabled()
  })

  it('should show publish loading state while publishing', () => {
    render(
      <SnippetHeader
        snippetId="snippet-1"
        canSave
        canEdit
        isPublishing
        onPublish={mockPublish}
      />,
    )

    expectLoadingButton(screen.getByRole('button', { name: /snippet\.publishButton/i }))
  })
})
