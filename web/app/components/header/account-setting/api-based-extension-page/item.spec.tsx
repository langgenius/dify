import type { TFunction } from 'i18next'
import type { ModalContextState } from '@/context/modal-context'
import type { ApiBasedExtension } from '@/models/common'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as reactI18next from 'react-i18next'
import { useModalContext } from '@/context/modal-context'
import { deleteApiBasedExtension } from '@/service/common'
import Item from './item'

// Mock dependencies
vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  deleteApiBasedExtension: vi.fn(),
}))

describe('Item Component', () => {
  const mockData: ApiBasedExtension = {
    id: '1',
    name: 'Test Extension',
    api_endpoint: 'https://api.example.com',
    api_key: 'test-api-key',
  }
  const mockOnUpdate = vi.fn()
  const mockSetShowApiBasedExtensionModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContext).mockReturnValue({
      setShowApiBasedExtensionModal: mockSetShowApiBasedExtensionModal,
    } as unknown as ModalContextState)
  })

  describe('Rendering', () => {
    it('should render extension data correctly', () => {
      // Act
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)

      // Assert
      expect(screen.getByText('Test Extension')).toBeInTheDocument()
      expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    })

    it('should render with minimal extension data', () => {
      // Arrange
      const minimalData: ApiBasedExtension = { id: '2' }

      // Act
      render(<Item data={minimalData} onUpdate={mockOnUpdate} />)

      // Assert
      expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })
  })

  describe('Modal Interactions', () => {
    it('should open edit modal with correct payload when clicking edit button', () => {
      // Act
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)
      fireEvent.click(screen.getByText('common.operation.edit'))

      // Assert
      expect(mockSetShowApiBasedExtensionModal).toHaveBeenCalledWith(expect.objectContaining({
        payload: mockData,
      }))
      const lastCall = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
      if (typeof lastCall === 'object' && lastCall !== null && 'onSaveCallback' in lastCall)
        expect(lastCall.onSaveCallback).toBeInstanceOf(Function)
    })

    it('should execute onUpdate callback when edit modal save callback is invoked', () => {
      // Act
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)
      fireEvent.click(screen.getByText('common.operation.edit'))

      // Assert
      const modalCallArg = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
      if (typeof modalCallArg === 'object' && modalCallArg !== null && 'onSaveCallback' in modalCallArg) {
        const onSaveCallback = modalCallArg.onSaveCallback
        if (onSaveCallback) {
          onSaveCallback()
          expect(mockOnUpdate).toHaveBeenCalledTimes(1)
        }
      }
    })
  })

  describe('Deletion', () => {
    it('should show delete confirmation dialog when clicking delete button', () => {
      // Act
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)
      fireEvent.click(screen.getByText('common.operation.delete'))

      // Assert
      expect(screen.getByText(/common\.operation\.delete.*Test Extension.*\?/i)).toBeInTheDocument()
    })

    it('should call delete API and triggers onUpdate when confirming deletion', async () => {
      // Arrange
      vi.mocked(deleteApiBasedExtension).mockResolvedValue({ result: 'success' })
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)

      // Act
      fireEvent.click(screen.getByText('common.operation.delete'))
      const dialog = screen.getByTestId('confirm-overlay')
      const confirmButton = within(dialog).getByText('common.operation.delete')
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(deleteApiBasedExtension).toHaveBeenCalledWith('/api-based-extension/1')
        expect(mockOnUpdate).toHaveBeenCalledTimes(1)
      })
    })

    it('should hide delete confirmation dialog after successful deletion', async () => {
      // Arrange
      vi.mocked(deleteApiBasedExtension).mockResolvedValue({ result: 'success' })
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)

      // Act
      fireEvent.click(screen.getByText('common.operation.delete'))
      const dialog = screen.getByTestId('confirm-overlay')
      const confirmButton = within(dialog).getByText('common.operation.delete')
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(screen.queryByText(/common\.operation\.delete.*Test Extension.*\?/i)).not.toBeInTheDocument()
      })
    })

    it('should close delete confirmation when clicking cancel button', () => {
      // Act
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)
      fireEvent.click(screen.getByText('common.operation.delete'))
      fireEvent.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(screen.queryByText(/common\.operation\.delete.*Test Extension.*\?/i)).not.toBeInTheDocument()
    })

    it('should not call delete API when canceling deletion', () => {
      // Act
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)
      fireEvent.click(screen.getByText('common.operation.delete'))
      fireEvent.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(deleteApiBasedExtension).not.toHaveBeenCalled()
      expect(mockOnUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should still show confirmation modal when operation.delete translation is missing', () => {
      // Arrange
      const useTranslationSpy = vi.spyOn(reactI18next, 'useTranslation')
      const originalValue = useTranslationSpy.getMockImplementation()?.() || {
        t: (key: string) => key,
        i18n: { language: 'en', changeLanguage: vi.fn() },
      }

      useTranslationSpy.mockReturnValue({
        ...originalValue,
        t: vi.fn().mockImplementation((key: string) => {
          if (key === 'operation.delete')
            return ''
          return key
        }) as unknown as TFunction,
      } as unknown as ReturnType<typeof reactI18next.useTranslation>)

      // Act
      render(<Item data={mockData} onUpdate={mockOnUpdate} />)
      const allButtons = screen.getAllByRole('button')
      const editBtn = screen.getByText('operation.edit')
      const deleteBtn = allButtons.find(btn => btn !== editBtn)
      if (deleteBtn)
        fireEvent.click(deleteBtn)

      // Assert
      expect(screen.getByText(/.*Test Extension.*\?/i)).toBeInTheDocument()

      useTranslationSpy.mockRestore()
    })
  })
})
