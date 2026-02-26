import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RenameModal from './rename-modal'

describe('RenameModal', () => {
  const defaultProps = {
    isShow: true,
    saveLoading: false,
    name: 'Original Name',
    onClose: vi.fn(),
    onSave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render with initial name', () => {
    render(<RenameModal {...defaultProps} />)

    expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Original Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.chat.conversationNamePlaceholder')).toBeInTheDocument()
  })

  it('should update text when typing', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    const input = screen.getByDisplayValue('Original Name')
    await user.clear(input)
    await user.type(input, 'New Name')

    expect(input).toHaveValue('New Name')
  })

  it('should call onSave with new name when save button is clicked', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    const input = screen.getByDisplayValue('Original Name')
    await user.clear(input)
    await user.type(input, 'Updated Name')

    const saveButton = screen.getByText('common.operation.save')
    await user.click(saveButton)

    expect(defaultProps.onSave).toHaveBeenCalledWith('Updated Name')
  })

  it('should call onClose when cancel button is clicked', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    const cancelButton = screen.getByText('common.operation.cancel')
    await user.click(cancelButton)

    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('should show loading state on save button', () => {
    render(<RenameModal {...defaultProps} saveLoading={true} />)

    // The Button component with loading=true renders a status role (spinner)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should not render when isShow is false', () => {
    const { queryByText } = render(<RenameModal {...defaultProps} isShow={false} />)
    expect(queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
  })
})
