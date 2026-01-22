import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'
import { DocumentContext } from '../../context'
import ActionButtons from './action-buttons'

// Create wrapper component for providing context
const createWrapper = (contextValue: {
  docForm?: ChunkingMode
  parentMode?: 'paragraph' | 'full-doc'
}) => {
  return ({ children }: { children: React.ReactNode }) => (
    <DocumentContext.Provider value={contextValue}>
      {children}
    </DocumentContext.Provider>
  )
}

describe('ActionButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Assert
      expect(screen.getByText(/operation\.cancel/i)).toBeInTheDocument()
    })

    it('should render save button', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Assert
      expect(screen.getByText(/operation\.save/i)).toBeInTheDocument()
    })

    it('should render ESC keyboard hint on cancel button', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Assert
      expect(screen.getByText('ESC')).toBeInTheDocument()
    })

    it('should render S keyboard hint on save button', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Assert
      expect(screen.getByText('S')).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call handleCancel when cancel button is clicked', () => {
      // Arrange
      const mockHandleCancel = vi.fn()
      render(
        <ActionButtons
          handleCancel={mockHandleCancel}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Act
      const cancelButton = screen.getAllByRole('button')[0]
      fireEvent.click(cancelButton)

      // Assert
      expect(mockHandleCancel).toHaveBeenCalledTimes(1)
    })

    it('should call handleSave when save button is clicked', () => {
      // Arrange
      const mockHandleSave = vi.fn()
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={mockHandleSave}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Act
      const buttons = screen.getAllByRole('button')
      const saveButton = buttons[buttons.length - 1] // Save button is last
      fireEvent.click(saveButton)

      // Assert
      expect(mockHandleSave).toHaveBeenCalledTimes(1)
    })

    it('should disable save button when loading is true', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={true}
        />,
        { wrapper: createWrapper({}) },
      )

      // Assert
      const buttons = screen.getAllByRole('button')
      const saveButton = buttons[buttons.length - 1]
      expect(saveButton).toBeDisabled()
    })
  })

  // Regeneration button tests
  describe('Regeneration Button', () => {
    it('should show regeneration button in parent-child paragraph mode for edit action', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={vi.fn()}
          loading={false}
          actionType="edit"
          isChildChunk={false}
          showRegenerationButton={true}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Assert
      expect(screen.getByText(/operation\.saveAndRegenerate/i)).toBeInTheDocument()
    })

    it('should not show regeneration button when isChildChunk is true', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={vi.fn()}
          loading={false}
          actionType="edit"
          isChildChunk={true}
          showRegenerationButton={true}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Assert
      expect(screen.queryByText(/operation\.saveAndRegenerate/i)).not.toBeInTheDocument()
    })

    it('should not show regeneration button when showRegenerationButton is false', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={vi.fn()}
          loading={false}
          actionType="edit"
          isChildChunk={false}
          showRegenerationButton={false}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Assert
      expect(screen.queryByText(/operation\.saveAndRegenerate/i)).not.toBeInTheDocument()
    })

    it('should not show regeneration button when actionType is add', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={vi.fn()}
          loading={false}
          actionType="add"
          isChildChunk={false}
          showRegenerationButton={true}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Assert
      expect(screen.queryByText(/operation\.saveAndRegenerate/i)).not.toBeInTheDocument()
    })

    it('should call handleRegeneration when regeneration button is clicked', () => {
      // Arrange
      const mockHandleRegeneration = vi.fn()
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={mockHandleRegeneration}
          loading={false}
          actionType="edit"
          isChildChunk={false}
          showRegenerationButton={true}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Act
      const regenerationButton = screen.getByText(/operation\.saveAndRegenerate/i).closest('button')
      if (regenerationButton)
        fireEvent.click(regenerationButton)

      // Assert
      expect(mockHandleRegeneration).toHaveBeenCalledTimes(1)
    })

    it('should disable regeneration button when loading is true', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={vi.fn()}
          loading={true}
          actionType="edit"
          isChildChunk={false}
          showRegenerationButton={true}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Assert
      const regenerationButton = screen.getByText(/operation\.saveAndRegenerate/i).closest('button')
      expect(regenerationButton).toBeDisabled()
    })
  })

  // Default props tests
  describe('Default Props', () => {
    it('should use default actionType of edit', () => {
      // Arrange & Act - when not specifying actionType and other conditions are met
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={vi.fn()}
          loading={false}
          showRegenerationButton={true}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Assert - regeneration button should show with default actionType='edit'
      expect(screen.getByText(/operation\.saveAndRegenerate/i)).toBeInTheDocument()
    })

    it('should use default isChildChunk of false', () => {
      // Arrange & Act - when not specifying isChildChunk
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={vi.fn()}
          loading={false}
          actionType="edit"
          showRegenerationButton={true}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Assert - regeneration button should show with default isChildChunk=false
      expect(screen.getByText(/operation\.saveAndRegenerate/i)).toBeInTheDocument()
    })

    it('should use default showRegenerationButton of true', () => {
      // Arrange & Act - when not specifying showRegenerationButton
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          handleRegeneration={vi.fn()}
          loading={false}
          actionType="edit"
          isChildChunk={false}
        />,
        { wrapper: createWrapper({ docForm: ChunkingMode.parentChild, parentMode: 'paragraph' }) },
      )

      // Assert - regeneration button should show with default showRegenerationButton=true
      expect(screen.getByText(/operation\.saveAndRegenerate/i)).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle missing context values gracefully', () => {
      // Arrange & Act & Assert - should not throw
      expect(() => {
        render(
          <ActionButtons
            handleCancel={vi.fn()}
            handleSave={vi.fn()}
            loading={false}
          />,
          { wrapper: createWrapper({}) },
        )
      }).not.toThrow()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Act
      rerender(
        <DocumentContext.Provider value={{}}>
          <ActionButtons
            handleCancel={vi.fn()}
            handleSave={vi.fn()}
            loading={true}
          />
        </DocumentContext.Provider>,
      )

      // Assert
      expect(screen.getByText(/operation\.cancel/i)).toBeInTheDocument()
      expect(screen.getByText(/operation\.save/i)).toBeInTheDocument()
    })
  })

  // Note: Keyboard shortcuts are handled by useKeyPress from ahooks
  // which requires special mocking. The hook integration is tested
  // by verifying keyboard hints are displayed in the UI.
  describe('Keyboard Hints', () => {
    it('should display ctrl key hint on save button', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Assert - check for ctrl key hint (Ctrl or Cmd depending on system)
      const kbdElements = document.querySelectorAll('.system-kbd')
      expect(kbdElements.length).toBeGreaterThan(0)
    })
  })
})
