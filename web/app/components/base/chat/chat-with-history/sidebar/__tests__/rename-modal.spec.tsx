import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as ReactI18next from 'react-i18next'
import { expectLoadingButton } from '@/test/button'
import { withSelectorKey } from '@/test/i18n-mock'
import { RenameConversationDialog } from '../rename-modal'

describe('RenameConversationDialog', () => {
  const defaultProps = {
    open: true,
    saveLoading: false,
    name: 'Original Name',
    onOpenChange: vi.fn(),
    onSave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title, label, input and action buttons', () => {
    render(<RenameConversationDialog {...defaultProps} />)

    expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'common.chat.conversationName' })).toHaveValue(
      'Original Name',
    )
    expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    expect(screen.getByText('common.operation.save')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(<RenameConversationDialog {...defaultProps} open={false} />)
    expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
  })

  it('calls onOpenChange when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<RenameConversationDialog {...defaultProps} />)

    await user.click(screen.getByText('common.operation.cancel'))
    expect(defaultProps.onOpenChange).toHaveBeenCalled()
  })

  it('calls onSave with updated name', async () => {
    const user = userEvent.setup()
    render(<RenameConversationDialog {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Updated Name')
    await user.keyboard('{Enter}')

    expect(defaultProps.onSave).toHaveBeenCalledWith('Updated Name')
  })

  it('keeps the draft read-only and blocks dismissal and resubmission while saving, then allows retry', async () => {
    const user = userEvent.setup()
    const view = render(<RenameConversationDialog {...defaultProps} />)
    const input = screen.getByRole('textbox', { name: 'common.chat.conversationName' })
    await user.clear(input)
    await user.type(input, 'Draft name')
    const save = screen.getByRole('button', { name: 'common.operation.save' })
    await user.click(save)
    expect(defaultProps.onSave).toHaveBeenCalledExactlyOnceWith('Draft name')

    view.rerender(<RenameConversationDialog {...defaultProps} saveLoading />)
    expect(input).toHaveAttribute('readonly')
    expect(save).toHaveFocus()
    await user.type(input, 'ignored')
    await user.click(save)
    await user.keyboard('{Enter}{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1)
    expect(defaultProps.onOpenChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('Draft name')

    view.rerender(<RenameConversationDialog {...defaultProps} />)
    expect(input).not.toHaveAttribute('readonly')
    await user.click(save)
    expect(defaultProps.onSave).toHaveBeenCalledTimes(2)
    expect(defaultProps.onSave).toHaveBeenLastCalledWith('Draft name')
  })

  it('calls onSave with initial name when unchanged', async () => {
    const user = userEvent.setup()
    render(<RenameConversationDialog {...defaultProps} />)

    await user.click(screen.getByText('common.operation.save'))
    expect(defaultProps.onSave).toHaveBeenCalledWith('Original Name')
  })

  it('shows loading state when saveLoading is true', () => {
    render(<RenameConversationDialog {...defaultProps} saveLoading />)
    const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
    expectLoadingButton(saveButton)
    expect(saveButton.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('hides loading state when saveLoading is false', () => {
    render(<RenameConversationDialog {...defaultProps} saveLoading={false} />)
    const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
    expect(saveButton).not.toBeDisabled()
    expect(saveButton).not.toHaveAttribute('aria-busy')
    expect(saveButton.querySelector('.animate-spin')).not.toBeInTheDocument()
  })

  it('keeps edited name when parent rerenders with different name prop', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<RenameConversationDialog {...defaultProps} name="First" />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Edited')

    rerender(<RenameConversationDialog {...defaultProps} name="Second" />)
    expect(screen.getByRole('textbox')).toHaveValue('Edited')
  })

  it('starts a fresh draft after closing finishes and the dialog opens again', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<RenameConversationDialog {...defaultProps} open />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Changed')

    rerender(<RenameConversationDialog {...defaultProps} open={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(<RenameConversationDialog {...defaultProps} name="Latest name" open />)

    expect(screen.getByRole('textbox')).toHaveValue('Latest name')
  })

  it('uses empty placeholder fallback when translation returns empty string', () => {
    const originalUseTranslation = ReactI18next.useTranslation
    const useTranslationSpy = vi
      .spyOn(ReactI18next, 'useTranslation')
      .mockImplementation((...args) => {
        const translation = originalUseTranslation(...args)
        return {
          ...translation,
          t: withSelectorKey((key: string, options?: Record<string, unknown>) => {
            if (key === 'chat.conversationNamePlaceholder') return ''
            const ns = options?.ns as string | undefined
            return ns ? `${ns}.${key}` : key
          }) as typeof translation.t,
        }
      })

    try {
      render(<RenameConversationDialog {...defaultProps} />)
      expect(screen.getByPlaceholderText('')).toBeInTheDocument()
    } finally {
      useTranslationSpy.mockRestore()
    }
  })
})
