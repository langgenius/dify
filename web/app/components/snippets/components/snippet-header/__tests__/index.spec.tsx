import type { ReactNode } from 'react'
import type { HeaderProps } from '@/app/components/workflow/header'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expectLoadingButton } from '@/test/button'
import SnippetHeader from '..'

vi.mock('@langgenius/dify-ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancelButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogConfirmButton: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children, render }: { children?: ReactNode, render?: ReactNode }) => render ?? <button type="button">{children}</button>,
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
  const mockCancel = vi.fn()
  const mockEdit = vi.fn()
  const mockExitEditing = vi.fn()
  const mockExitEditingWithoutSave = vi.fn()
  const mockPublish = vi.fn()
  const mockSaveAndExit = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verifies the wrapper passes the expected workflow header configuration.
  describe('Rendering', () => {
    it('should configure workflow header slots and hide workflow-only controls', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges
          canSave
          hasDraftChanges={false}
          isEditing={false}
          isPublishing={false}
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      const header = screen.getByTestId('workflow-header')
      expect(header).toHaveAttribute('data-show-env', 'false')
      expect(header).toHaveAttribute('data-show-global-variable', 'false')
      expect(header).toHaveAttribute('data-history-url', '/snippets/snippet-1/workflow-runs')
      expect(screen.getByText('snippet.viewOnly')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /snippet\.edit/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /snippet\.testRunButton/i })).toBeInTheDocument()
    })
  })

  // Verifies forwarded callbacks still drive the snippet-specific controls.
  describe('User Interactions', () => {
    it('should invoke the snippet callbacks when save and discard are clicked in editing mode', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges
          canSave
          hasDraftChanges
          isEditing
          isPublishing={false}
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /^snippet\.save$/i }))
      fireEvent.click(screen.getByRole('button', { name: /snippet\.discardChanges/i }))

      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockCancel).toHaveBeenCalledTimes(1)
    })

    it('should disable save actions when the current graph has no nodes', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges
          canSave={false}
          hasDraftChanges
          isEditing
          isPublishing={false}
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      expect(screen.getByRole('button', { name: /^snippet\.save$/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /snippet\.saveAndExit/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /snippet\.doNotSave/i })).not.toBeDisabled()
    })

    it('should hide the discard draft action when there is no published workflow', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges={false}
          canSave
          hasDraftChanges
          isEditing
          isPublishing={false}
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      expect(screen.queryByText('snippet.discardDraft')).not.toBeInTheDocument()
      expect(screen.getByText('snippet.editingDraft')).toBeInTheDocument()
    })

    it('should enter editing mode from the readonly header action', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges
          canSave
          hasDraftChanges={false}
          isEditing={false}
          isPublishing={false}
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'snippet.edit' }))

      expect(mockEdit).toHaveBeenCalledTimes(1)
    })

    it('should exit editing immediately when there are no draft changes', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges
          canSave
          hasDraftChanges={false}
          isEditing
          isPublishing={false}
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'snippet.exitEditing' }))

      expect(mockExitEditing).toHaveBeenCalledTimes(1)
      expect(mockExitEditingWithoutSave).not.toHaveBeenCalled()
      expect(mockSaveAndExit).not.toHaveBeenCalled()
    })

    it('should disable edit actions while publishing', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges
          canSave
          hasDraftChanges
          isEditing
          isPublishing
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      expect(screen.getByRole('button', { name: 'snippet.exitEditing' })).toBeDisabled()
      expectLoadingButton(screen.getByRole('button', { name: /^snippet\.save$/i }))
      expect(screen.getByRole('button', { name: 'snippet.doNotSave' })).toBeDisabled()
    })

    it('should discard changes from the exit confirmation dialog', async () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges
          canSave
          hasDraftChanges
          isEditing
          isPublishing={false}
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'snippet.exitEditing' }))
      fireEvent.click(screen.getByRole('button', { name: 'snippet.doNotSave' }))

      await waitFor(() => {
        expect(mockExitEditingWithoutSave).toHaveBeenCalledTimes(1)
      })
      expect(mockSaveAndExit).not.toHaveBeenCalled()
    })

    it('should save and exit from the exit confirmation dialog', async () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          canDiscardChanges
          canSave
          hasDraftChanges
          isEditing
          isPublishing={false}
          onCancel={mockCancel}
          onEdit={mockEdit}
          onExitEditing={mockExitEditing}
          onExitEditingWithoutSave={mockExitEditingWithoutSave}
          onPublish={mockPublish}
          onSaveAndExitEditing={mockSaveAndExit}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'snippet.exitEditing' }))
      fireEvent.click(screen.getByRole('button', { name: 'snippet.saveAndExit' }))

      await waitFor(() => {
        expect(mockSaveAndExit).toHaveBeenCalledTimes(1)
      })
      expect(mockExitEditingWithoutSave).not.toHaveBeenCalled()
    })
  })
})
