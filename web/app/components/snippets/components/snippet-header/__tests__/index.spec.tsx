import type { ReactNode } from 'react'
import type { HeaderProps } from '@/app/components/workflow/header'
import { fireEvent, render, screen } from '@testing-library/react'
import SnippetHeader from '..'

vi.mock('@langgenius/dify-ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancelButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogConfirmButton: ({ children, onClick }: { children: ReactNode, onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}))

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
        <button type="button">
          {props.normal?.runAndHistoryProps?.runButtonText ?? 'snippet.testRunButton'}
        </button>
        {props.normal?.components?.middle}
      </div>
    )
  },
}))

describe('SnippetHeader', () => {
  const mockCancel = vi.fn()
  const mockPublish = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verifies the wrapper passes the expected workflow header configuration.
  describe('Rendering', () => {
    it('should configure workflow header slots and hide workflow-only controls', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          isPublishing={false}
          onCancel={mockCancel}
          onPublish={mockPublish}
        />,
      )

      const header = screen.getByTestId('workflow-header')
      expect(header).toHaveAttribute('data-show-env', 'false')
      expect(header).toHaveAttribute('data-show-global-variable', 'false')
      expect(header).toHaveAttribute('data-history-url', '/snippets/snippet-1/workflow-runs')
      expect(screen.getByRole('button', { name: /snippet\.cancel/i })).toBeInTheDocument()
      expect(screen.getByText('snippet.unsavedChanges')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /snippet\.save/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /snippet\.testRunButton/i })).toBeInTheDocument()
    })
  })

  // Verifies forwarded callbacks still drive the snippet-specific controls.
  describe('User Interactions', () => {
    it('should invoke the snippet callbacks when save and discard are clicked', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          isPublishing={false}
          onCancel={mockCancel}
          onPublish={mockPublish}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /snippet\.save/i }))
      fireEvent.click(screen.getByRole('button', { name: /snippet\.discardChanges/i }))

      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockCancel).toHaveBeenCalledTimes(1)
    })
  })
})
