import type { MockedFunction } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { createEmptyDataset } from '@/service/datasets'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import EmptyDatasetCreationModal from './index'

// Mock Next.js router
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock createEmptyDataset API
vi.mock('@/service/datasets', () => ({
  createEmptyDataset: vi.fn(),
}))

// Mock useInvalidDatasetList hook
vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: vi.fn(),
}))

// Mock ToastContext - need to mock both createContext and useContext from use-context-selector
const mockNotify = vi.fn()
vi.mock('use-context-selector', () => ({
  createContext: vi.fn(() => ({
    Provider: ({ children }: { children: React.ReactNode }) => children,
  })),
  useContext: vi.fn(() => ({ notify: mockNotify })),
}))

// Type cast mocked functions
const mockCreateEmptyDataset = createEmptyDataset as MockedFunction<typeof createEmptyDataset>
const mockInvalidDatasetList = vi.fn()
const mockUseInvalidDatasetList = useInvalidDatasetList as MockedFunction<typeof useInvalidDatasetList>

// Test data builder for props
const createDefaultProps = (overrides?: Partial<{ show: boolean, onHide: () => void }>) => ({
  show: true,
  onHide: vi.fn(),
  ...overrides,
})

describe('EmptyDatasetCreationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseInvalidDatasetList.mockReturnValue(mockInvalidDatasetList)
    mockCreateEmptyDataset.mockResolvedValue({
      id: 'dataset-123',
      name: 'Test Dataset',
    } as ReturnType<typeof createEmptyDataset> extends Promise<infer T> ? T : never)
  })

  // ==========================================
  // Rendering Tests - Verify component renders correctly
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing when show is true', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<EmptyDatasetCreationModal {...props} />)

      // Assert - Check modal title is rendered
      expect(screen.getByText('datasetCreation.stepOne.modal.title')).toBeInTheDocument()
    })

    it('should render modal with correct elements', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<EmptyDatasetCreationModal {...props} />)

      // Assert
      expect(screen.getByText('datasetCreation.stepOne.modal.title')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.modal.tip')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.modal.input')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.modal.confirmButton')).toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepOne.modal.cancelButton')).toBeInTheDocument()
    })

    it('should render input with empty value initially', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<EmptyDatasetCreationModal {...props} />)

      // Assert
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder') as HTMLInputElement
      expect(input.value).toBe('')
    })

    it('should not render modal content when show is false', () => {
      // Arrange
      const props = createDefaultProps({ show: false })

      // Act
      render(<EmptyDatasetCreationModal {...props} />)

      // Assert - Modal should not be visible (check for absence of title)
      expect(screen.queryByText('datasetCreation.stepOne.modal.title')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing - Verify all prop variations work correctly
  // ==========================================
  describe('Props', () => {
    describe('show prop', () => {
      it('should show modal when show is true', () => {
        // Arrange & Act
        render(<EmptyDatasetCreationModal show={true} onHide={vi.fn()} />)

        // Assert
        expect(screen.getByText('datasetCreation.stepOne.modal.title')).toBeInTheDocument()
      })

      it('should hide modal when show is false', () => {
        // Arrange & Act
        render(<EmptyDatasetCreationModal show={false} onHide={vi.fn()} />)

        // Assert
        expect(screen.queryByText('datasetCreation.stepOne.modal.title')).not.toBeInTheDocument()
      })

      it('should toggle visibility when show prop changes', () => {
        // Arrange
        const onHide = vi.fn()
        const { rerender } = render(<EmptyDatasetCreationModal show={false} onHide={onHide} />)

        // Act & Assert - Initially hidden
        expect(screen.queryByText('datasetCreation.stepOne.modal.title')).not.toBeInTheDocument()

        // Act & Assert - Show modal
        rerender(<EmptyDatasetCreationModal show={true} onHide={onHide} />)
        expect(screen.getByText('datasetCreation.stepOne.modal.title')).toBeInTheDocument()
      })
    })

    describe('onHide prop', () => {
      it('should call onHide when cancel button is clicked', () => {
        // Arrange
        const mockOnHide = vi.fn()
        render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)

        // Act
        const cancelButton = screen.getByText('datasetCreation.stepOne.modal.cancelButton')
        fireEvent.click(cancelButton)

        // Assert
        expect(mockOnHide).toHaveBeenCalledTimes(1)
      })

      it('should call onHide when close icon is clicked', async () => {
        // Arrange
        const mockOnHide = vi.fn()
        render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)

        // Act - Wait for modal to be rendered, then find the close span
        // The close span is located in the modalHeader div, next to the title
        const titleElement = await screen.findByText('datasetCreation.stepOne.modal.title')
        const headerDiv = titleElement.parentElement
        const closeButton = headerDiv?.querySelector('span')

        expect(closeButton).toBeInTheDocument()
        fireEvent.click(closeButton!)

        // Assert
        expect(mockOnHide).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ==========================================
  // State Management - Test input state updates
  // ==========================================
  describe('State Management', () => {
    it('should update input value when user types', () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder') as HTMLInputElement

      // Act
      fireEvent.change(input, { target: { value: 'My Dataset' } })

      // Assert
      expect(input.value).toBe('My Dataset')
    })

    it('should persist input value when modal is hidden and shown again via rerender', () => {
      // Arrange
      const onHide = vi.fn()
      const { rerender } = render(<EmptyDatasetCreationModal show={true} onHide={onHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder') as HTMLInputElement

      // Act - Type in input
      fireEvent.change(input, { target: { value: 'Test Dataset' } })
      expect(input.value).toBe('Test Dataset')

      // Hide and show modal via rerender (component is not unmounted, state persists)
      rerender(<EmptyDatasetCreationModal show={false} onHide={onHide} />)
      rerender(<EmptyDatasetCreationModal show={true} onHide={onHide} />)

      // Assert - Input value persists because component state is preserved during rerender
      const newInput = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder') as HTMLInputElement
      expect(newInput.value).toBe('Test Dataset')
    })

    it('should handle consecutive input changes', () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder') as HTMLInputElement

      // Act & Assert
      fireEvent.change(input, { target: { value: 'A' } })
      expect(input.value).toBe('A')

      fireEvent.change(input, { target: { value: 'AB' } })
      expect(input.value).toBe('AB')

      fireEvent.change(input, { target: { value: 'ABC' } })
      expect(input.value).toBe('ABC')
    })
  })

  // ==========================================
  // User Interactions - Test event handlers
  // ==========================================
  describe('User Interactions', () => {
    it('should submit form when confirm button is clicked with valid input', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Valid Dataset Name' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: 'Valid Dataset Name' })
      })
    })

    it('should show error notification when input is empty', async () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Click confirm without entering a name
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.modal.nameNotEmpty',
        })
      })
      expect(mockCreateEmptyDataset).not.toHaveBeenCalled()
    })

    it('should show error notification when input exceeds 40 characters', async () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Enter a name longer than 40 characters
      const longName = 'A'.repeat(41)
      fireEvent.change(input, { target: { value: longName } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.modal.nameLengthInvalid',
        })
      })
      expect(mockCreateEmptyDataset).not.toHaveBeenCalled()
    })

    it('should allow exactly 40 characters', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Enter exactly 40 characters
      const exactLengthName = 'A'.repeat(40)
      fireEvent.change(input, { target: { value: exactLengthName } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: exactLengthName })
      })
    })

    it('should close modal on cancel button click', () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const cancelButton = screen.getByText('datasetCreation.stepOne.modal.cancelButton')

      // Act
      fireEvent.click(cancelButton)

      // Assert
      expect(mockOnHide).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================
  // API Calls - Test API interactions
  // ==========================================
  describe('API Calls', () => {
    it('should call createEmptyDataset with correct parameters', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'New Dataset' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: 'New Dataset' })
      })
    })

    it('should call invalidDatasetList after successful creation', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Test Dataset' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockInvalidDatasetList).toHaveBeenCalled()
      })
    })

    it('should call onHide after successful creation', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Test Dataset' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockOnHide).toHaveBeenCalled()
      })
    })

    it('should show error notification on API failure', async () => {
      // Arrange
      mockCreateEmptyDataset.mockRejectedValue(new Error('API Error'))
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Test Dataset' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.modal.failed',
        })
      })
    })

    it('should not call onHide on API failure', async () => {
      // Arrange
      mockCreateEmptyDataset.mockRejectedValue(new Error('API Error'))
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Test Dataset' } })
      fireEvent.click(confirmButton)

      // Assert - Wait for API call to complete
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalled()
      })
      // onHide should not be called on failure
      expect(mockOnHide).not.toHaveBeenCalled()
    })

    it('should not invalidate dataset list on API failure', async () => {
      // Arrange
      mockCreateEmptyDataset.mockRejectedValue(new Error('API Error'))
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Test Dataset' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalled()
      })
      expect(mockInvalidDatasetList).not.toHaveBeenCalled()
    })
  })

  // ==========================================
  // Router Navigation - Test Next.js router
  // ==========================================
  describe('Router Navigation', () => {
    it('should navigate to dataset documents page after successful creation', async () => {
      // Arrange
      mockCreateEmptyDataset.mockResolvedValue({
        id: 'test-dataset-456',
        name: 'Test',
      } as ReturnType<typeof createEmptyDataset> extends Promise<infer T> ? T : never)
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Test' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-456/documents')
      })
    })

    it('should not navigate on validation error', async () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Click confirm with empty input
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalled()
      })
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should not navigate on API error', async () => {
      // Arrange
      mockCreateEmptyDataset.mockRejectedValue(new Error('API Error'))
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Test' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalled()
      })
      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  // ==========================================
  // Edge Cases - Test boundary conditions and error handling
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle whitespace-only input as valid (component behavior)', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Enter whitespace only
      fireEvent.change(input, { target: { value: '   ' } })
      fireEvent.click(confirmButton)

      // Assert - Current implementation treats whitespace as valid input
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: '   ' })
      })
    })

    it('should handle special characters in input', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Test @#$% Dataset!' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: 'Test @#$% Dataset!' })
      })
    })

    it('should handle Unicode characters in input', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: '数据集测试 🚀' } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: '数据集测试 🚀' })
      })
    })

    it('should handle input at exactly 40 character boundary', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Test boundary: 40 characters is valid
      const name40Chars = 'A'.repeat(40)
      fireEvent.change(input, { target: { value: name40Chars } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: name40Chars })
      })
    })

    it('should reject input at 41 character boundary', async () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Test boundary: 41 characters is invalid
      const name41Chars = 'A'.repeat(41)
      fireEvent.change(input, { target: { value: name41Chars } })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.modal.nameLengthInvalid',
        })
      })
      expect(mockCreateEmptyDataset).not.toHaveBeenCalled()
    })

    it('should handle rapid consecutive submits', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Rapid clicks
      fireEvent.change(input, { target: { value: 'Test' } })
      fireEvent.click(confirmButton)
      fireEvent.click(confirmButton)
      fireEvent.click(confirmButton)

      // Assert - API will be called multiple times (no debounce in current implementation)
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalled()
      })
    })

    it('should handle input with leading/trailing spaces', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: '  Dataset Name  ' } })
      fireEvent.click(confirmButton)

      // Assert - Current implementation does not trim spaces
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: '  Dataset Name  ' })
      })
    })

    it('should handle newline characters in input (browser strips newlines)', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Line1\nLine2' } })
      fireEvent.click(confirmButton)

      // Assert - HTML input elements strip newline characters (expected browser behavior)
      await waitFor(() => {
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: 'Line1Line2' })
      })
    })
  })

  // ==========================================
  // Validation Tests - Test input validation
  // ==========================================
  describe('Validation', () => {
    it('should not submit when input is empty string', async () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.modal.nameNotEmpty',
        })
      })
    })

    it('should validate length before calling API', async () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'A'.repeat(50) } })
      fireEvent.click(confirmButton)

      // Assert - Should show error before API call
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.modal.nameLengthInvalid',
        })
      })
      expect(mockCreateEmptyDataset).not.toHaveBeenCalled()
    })

    it('should validate empty string before length check', async () => {
      // Arrange
      const props = createDefaultProps()
      render(<EmptyDatasetCreationModal {...props} />)
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act - Don't enter anything
      fireEvent.click(confirmButton)

      // Assert - Should show empty error, not length error
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.modal.nameNotEmpty',
        })
      })
    })
  })

  // ==========================================
  // Integration Tests - Test complete flows
  // ==========================================
  describe('Integration', () => {
    it('should complete full successful creation flow', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      mockCreateEmptyDataset.mockResolvedValue({
        id: 'new-id-789',
        name: 'Complete Flow Test',
      } as ReturnType<typeof createEmptyDataset> extends Promise<infer T> ? T : never)
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Complete Flow Test' } })
      fireEvent.click(confirmButton)

      // Assert - Verify complete flow
      await waitFor(() => {
        // 1. API called
        expect(mockCreateEmptyDataset).toHaveBeenCalledWith({ name: 'Complete Flow Test' })
        // 2. Dataset list invalidated
        expect(mockInvalidDatasetList).toHaveBeenCalled()
        // 3. Modal closed
        expect(mockOnHide).toHaveBeenCalled()
        // 4. Navigation happened
        expect(mockPush).toHaveBeenCalledWith('/datasets/new-id-789/documents')
      })
    })

    it('should handle error flow correctly', async () => {
      // Arrange
      const mockOnHide = vi.fn()
      mockCreateEmptyDataset.mockRejectedValue(new Error('Server Error'))
      render(<EmptyDatasetCreationModal show={true} onHide={mockOnHide} />)
      const input = screen.getByPlaceholderText('datasetCreation.stepOne.modal.placeholder')
      const confirmButton = screen.getByText('datasetCreation.stepOne.modal.confirmButton')

      // Act
      fireEvent.change(input, { target: { value: 'Error Test' } })
      fireEvent.click(confirmButton)

      // Assert - Verify error handling
      await waitFor(() => {
        // 1. API was called
        expect(mockCreateEmptyDataset).toHaveBeenCalled()
        // 2. Error notification shown
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetCreation.stepOne.modal.failed',
        })
      })

      // 3. These should NOT happen on error
      expect(mockInvalidDatasetList).not.toHaveBeenCalled()
      expect(mockOnHide).not.toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
