import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditItem, { EditItemType, EditTitle } from './index'

describe('EditTitle', () => {
  it('should render title content correctly', () => {
    // Arrange
    const props = { title: 'Test Title' }

    // Act
    render(<EditTitle {...props} />)

    // Assert
    expect(screen.getByText(/test title/i)).toBeInTheDocument()
    // Should contain edit icon (svg element)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('should apply custom className when provided', () => {
    // Arrange
    const props = {
      title: 'Test Title',
      className: 'custom-class',
    }

    // Act
    const { container } = render(<EditTitle {...props} />)

    // Assert
    expect(screen.getByText(/test title/i)).toBeInTheDocument()
    expect(container.querySelector('.custom-class')).toBeInTheDocument()
  })
})

describe('EditItem', () => {
  const defaultProps = {
    type: EditItemType.Query,
    content: 'Test content',
    onSave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render content correctly', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.getByText(/test content/i)).toBeInTheDocument()
      // Should show item name (query or answer)
      expect(screen.getByText('appAnnotation.editModal.queryName')).toBeInTheDocument()
    })

    it('should render different item types correctly', () => {
      // Arrange
      const props = {
        ...defaultProps,
        type: EditItemType.Answer,
        content: 'Answer content',
      }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.getByText(/answer content/i)).toBeInTheDocument()
      expect(screen.getByText('appAnnotation.editModal.answerName')).toBeInTheDocument()
    })

    it('should show edit controls when not readonly', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
    })

    it('should hide edit controls when readonly', () => {
      // Arrange
      const props = {
        ...defaultProps,
        readonly: true,
      }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should respect readonly prop for edit functionality', () => {
      // Arrange
      const props = {
        ...defaultProps,
        readonly: true,
      }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.getByText(/test content/i)).toBeInTheDocument()
      expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
    })

    it('should display provided content', () => {
      // Arrange
      const props = {
        ...defaultProps,
        content: 'Custom content for testing',
      }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.getByText(/custom content for testing/i)).toBeInTheDocument()
    })

    it('should render appropriate content based on type', () => {
      // Arrange
      const props = {
        ...defaultProps,
        type: EditItemType.Query,
        content: 'Question content',
      }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.getByText(/question content/i)).toBeInTheDocument()
      expect(screen.getByText('appAnnotation.editModal.queryName')).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should activate edit mode when edit button is clicked', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)
      await user.click(screen.getByText('common.operation.edit'))

      // Assert
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    })

    it('should save new content when save button is clicked', async () => {
      // Arrange
      const mockSave = vi.fn().mockResolvedValue(undefined)
      const props = {
        ...defaultProps,
        onSave: mockSave,
      }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)
      await user.click(screen.getByText('common.operation.edit'))

      // Type new content
      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Updated content')

      // Save
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(mockSave).toHaveBeenCalledWith('Updated content')
    })

    it('should exit edit mode when cancel button is clicked', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)
      await user.click(screen.getByText('common.operation.edit'))
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      // Assert
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText(/test content/i)).toBeInTheDocument()
    })

    it('should show content preview while typing', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)
      await user.click(screen.getByText('common.operation.edit'))

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'New content')

      // Assert
      expect(screen.getByText(/new content/i)).toBeInTheDocument()
    })

    it('should call onSave with correct content when saving', async () => {
      // Arrange
      const mockSave = vi.fn().mockResolvedValue(undefined)
      const props = {
        ...defaultProps,
        onSave: mockSave,
      }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)
      await user.click(screen.getByText('common.operation.edit'))

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Test save content')

      // Save
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(mockSave).toHaveBeenCalledWith('Test save content')
    })

    it('should show delete option and restore original content when delete is clicked', async () => {
      // Arrange
      const mockSave = vi.fn().mockResolvedValue(undefined)
      const props = {
        ...defaultProps,
        onSave: mockSave,
      }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)

      // Enter edit mode and change content
      await user.click(screen.getByText('common.operation.edit'))
      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Modified content')

      // Save to trigger content change
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert
      expect(mockSave).toHaveBeenNthCalledWith(1, 'Modified content')
      expect(await screen.findByText('common.operation.delete')).toBeInTheDocument()

      await user.click(screen.getByText('common.operation.delete'))

      expect(mockSave).toHaveBeenNthCalledWith(2, 'Test content')
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should handle keyboard interactions in edit mode', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)
      await user.click(screen.getByText('common.operation.edit'))

      const textarea = screen.getByRole('textbox')

      // Test typing
      await user.type(textarea, 'Keyboard test')

      // Assert
      expect(textarea).toHaveValue('Keyboard test')
      expect(screen.getByText(/keyboard test/i)).toBeInTheDocument()
    })
  })

  // State Management
  describe('State Management', () => {
    it('should reset newContent when content prop changes', async () => {
      // Arrange
      const { rerender } = render(<EditItem {...defaultProps} />)

      // Act - Enter edit mode and type something
      const user = userEvent.setup()
      await user.click(screen.getByText('common.operation.edit'))
      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'New content')

      // Rerender with new content prop
      rerender(<EditItem {...defaultProps} content="Updated content" />)

      // Assert - Textarea value should be reset due to useEffect
      expect(textarea).toHaveValue('')
    })

    it('should preserve edit state across content changes', async () => {
      // Arrange
      const { rerender } = render(<EditItem {...defaultProps} />)
      const user = userEvent.setup()

      // Act - Enter edit mode
      await user.click(screen.getByText('common.operation.edit'))

      // Rerender with new content
      rerender(<EditItem {...defaultProps} content="Updated content" />)

      // Assert - Should still be in edit mode
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle empty content', () => {
      // Arrange
      const props = {
        ...defaultProps,
        content: '',
      }

      // Act
      const { container } = render(<EditItem {...props} />)

      // Assert - Should render without crashing
      // Check that the component renders properly with empty content
      expect(container.querySelector('.grow')).toBeInTheDocument()
      // Should still show edit button
      expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
    })

    it('should handle very long content', () => {
      // Arrange
      const longContent = 'A'.repeat(1000)
      const props = {
        ...defaultProps,
        content: longContent,
      }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.getByText(longContent)).toBeInTheDocument()
    })

    it('should handle content with special characters', () => {
      // Arrange
      const specialContent = 'Content with & < > " \' characters'
      const props = {
        ...defaultProps,
        content: specialContent,
      }

      // Act
      render(<EditItem {...props} />)

      // Assert
      expect(screen.getByText(specialContent)).toBeInTheDocument()
    })

    it('should handle rapid edit/cancel operations', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)

      // Rapid edit/cancel operations
      await user.click(screen.getByText('common.operation.edit'))
      await user.click(screen.getByText('common.operation.cancel'))
      await user.click(screen.getByText('common.operation.edit'))
      await user.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('Test content')).toBeInTheDocument()
    })

    it('should handle save failure gracefully in edit mode', async () => {
      // Arrange
      const mockSave = vi.fn().mockRejectedValueOnce(new Error('Save failed'))
      const props = {
        ...defaultProps,
        onSave: mockSave,
      }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)

      // Enter edit mode and save (should fail)
      await user.click(screen.getByText('common.operation.edit'))
      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'New content')

      // Save should fail but not throw
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      // Assert - Should remain in edit mode when save fails
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
      expect(mockSave).toHaveBeenCalledWith('New content')
    })

    it('should handle delete action failure gracefully', async () => {
      // Arrange
      const mockSave = vi.fn()
        .mockResolvedValueOnce(undefined) // First save succeeds
        .mockRejectedValueOnce(new Error('Delete failed')) // Delete fails
      const props = {
        ...defaultProps,
        onSave: mockSave,
      }
      const user = userEvent.setup()

      // Act
      render(<EditItem {...props} />)

      // Edit content to show delete button
      await user.click(screen.getByText('common.operation.edit'))
      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Modified content')

      // Save to create new content
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      await screen.findByText('common.operation.delete')

      // Click delete (should fail but not throw)
      await user.click(screen.getByText('common.operation.delete'))

      // Assert - Delete action should handle error gracefully
      expect(mockSave).toHaveBeenCalledTimes(2)
      expect(mockSave).toHaveBeenNthCalledWith(1, 'Modified content')
      expect(mockSave).toHaveBeenNthCalledWith(2, 'Test content')

      // When delete fails, the delete button should still be visible (state not changed)
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      expect(screen.getByText('Modified content')).toBeInTheDocument()
    })
  })
})
