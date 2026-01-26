import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'
import { DocumentContext } from '../../context'
import ActionButtons from './action-buttons'

// Mock useKeyPress from ahooks to capture and test callback functions
const mockUseKeyPress = vi.fn()
vi.mock('ahooks', () => ({
  useKeyPress: (keys: string | string[], callback: (e: KeyboardEvent) => void, options?: object) => {
    mockUseKeyPress(keys, callback, options)
  },
}))

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

// Helper to get captured callbacks from useKeyPress mock
const getEscCallback = (): ((e: KeyboardEvent) => void) | undefined => {
  const escCall = mockUseKeyPress.mock.calls.find(
    (call) => {
      const keys = call[0]
      return Array.isArray(keys) && keys.includes('esc')
    },
  )
  return escCall?.[1]
}

const getCtrlSCallback = (): ((e: KeyboardEvent) => void) | undefined => {
  const ctrlSCall = mockUseKeyPress.mock.calls.find(
    (call) => {
      const keys = call[0]
      return typeof keys === 'string' && keys.includes('.s')
    },
  )
  return ctrlSCall?.[1]
}

describe('ActionButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseKeyPress.mockClear()
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

  // Keyboard shortcuts tests via useKeyPress callbacks
  describe('Keyboard Shortcuts', () => {
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

    it('should call handleCancel and preventDefault when ESC key is pressed', () => {
      // Arrange
      const mockHandleCancel = vi.fn()
      const mockPreventDefault = vi.fn()
      render(
        <ActionButtons
          handleCancel={mockHandleCancel}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Act - get the ESC callback and invoke it
      const escCallback = getEscCallback()
      expect(escCallback).toBeDefined()
      escCallback!({ preventDefault: mockPreventDefault } as unknown as KeyboardEvent)

      // Assert
      expect(mockPreventDefault).toHaveBeenCalledTimes(1)
      expect(mockHandleCancel).toHaveBeenCalledTimes(1)
    })

    it('should call handleSave and preventDefault when Ctrl+S is pressed and not loading', () => {
      // Arrange
      const mockHandleSave = vi.fn()
      const mockPreventDefault = vi.fn()
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={mockHandleSave}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Act - get the Ctrl+S callback and invoke it
      const ctrlSCallback = getCtrlSCallback()
      expect(ctrlSCallback).toBeDefined()
      ctrlSCallback!({ preventDefault: mockPreventDefault } as unknown as KeyboardEvent)

      // Assert
      expect(mockPreventDefault).toHaveBeenCalledTimes(1)
      expect(mockHandleSave).toHaveBeenCalledTimes(1)
    })

    it('should not call handleSave when Ctrl+S is pressed while loading', () => {
      // Arrange
      const mockHandleSave = vi.fn()
      const mockPreventDefault = vi.fn()
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={mockHandleSave}
          loading={true}
        />,
        { wrapper: createWrapper({}) },
      )

      // Act - get the Ctrl+S callback and invoke it
      const ctrlSCallback = getCtrlSCallback()
      expect(ctrlSCallback).toBeDefined()
      ctrlSCallback!({ preventDefault: mockPreventDefault } as unknown as KeyboardEvent)

      // Assert
      expect(mockPreventDefault).toHaveBeenCalledTimes(1)
      expect(mockHandleSave).not.toHaveBeenCalled()
    })

    it('should register useKeyPress with correct options for Ctrl+S', () => {
      // Arrange & Act
      render(
        <ActionButtons
          handleCancel={vi.fn()}
          handleSave={vi.fn()}
          loading={false}
        />,
        { wrapper: createWrapper({}) },
      )

      // Assert - verify useKeyPress was called with correct options
      const ctrlSCall = mockUseKeyPress.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('.s'),
      )
      expect(ctrlSCall).toBeDefined()
      expect(ctrlSCall![2]).toEqual({ exactMatch: true, useCapture: true })
    })
  })
})
