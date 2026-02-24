import type { SetStateAction } from 'react'
import type { ModalContextState, ModalState } from '@/context/modal-context'
import type { ApiBasedExtension } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import { useModalContext } from '@/context/modal-context'
import { useApiBasedExtensions } from '@/service/use-common'
import ApiBasedExtensionPage from './index'

vi.mock('@/service/use-common', () => ({
  useApiBasedExtensions: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

describe('ApiBasedExtensionPage', () => {
  const mockRefetch = vi.fn<() => void>()
  const mockSetShowApiBasedExtensionModal = vi.fn<(value: SetStateAction<ModalState<ApiBasedExtension> | null>) => void>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContext).mockReturnValue({
      setShowApiBasedExtensionModal: mockSetShowApiBasedExtensionModal,
    } as unknown as ModalContextState)
  })

  describe('Rendering', () => {
    it('should render empty state when no data exists', () => {
      // Arrange
      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: [],
        isPending: false,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      // Act
      render(<ApiBasedExtensionPage />)

      // Assert
      expect(screen.getByText('common.apiBasedExtension.title')).toBeInTheDocument()
    })

    it('should render list of extensions when data exists', () => {
      // Arrange
      const mockData = [
        { id: '1', name: 'Extension 1', api_endpoint: 'url1' },
        { id: '2', name: 'Extension 2', api_endpoint: 'url2' },
      ]

      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: mockData,
        isPending: false,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      // Act
      render(<ApiBasedExtensionPage />)

      // Assert
      expect(screen.getByText('Extension 1')).toBeInTheDocument()
      expect(screen.getByText('url1')).toBeInTheDocument()
      expect(screen.getByText('Extension 2')).toBeInTheDocument()
      expect(screen.getByText('url2')).toBeInTheDocument()
    })

    it('should handle loading state', () => {
      // Arrange
      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: null,
        isPending: true,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      // Act
      render(<ApiBasedExtensionPage />)

      // Assert
      expect(screen.queryByText('common.apiBasedExtension.title')).not.toBeInTheDocument()
      expect(screen.getByText('common.apiBasedExtension.add')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open modal when clicking add button', () => {
      // Arrange
      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: [],
        isPending: false,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      // Act
      render(<ApiBasedExtensionPage />)
      fireEvent.click(screen.getByText('common.apiBasedExtension.add'))

      // Assert
      expect(mockSetShowApiBasedExtensionModal).toHaveBeenCalledWith(expect.objectContaining({
        payload: {},
      }))
    })

    it('should call refetch when onSaveCallback is executed from the modal', () => {
      // Arrange
      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: [],
        isPending: false,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      // Act
      render(<ApiBasedExtensionPage />)
      fireEvent.click(screen.getByText('common.apiBasedExtension.add'))

      // Trigger callback manually from the mock call
      const callArgs = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
      if (typeof callArgs === 'object' && callArgs !== null && 'onSaveCallback' in callArgs) {
        if (callArgs.onSaveCallback) {
          callArgs.onSaveCallback()
          // Assert
          expect(mockRefetch).toHaveBeenCalled()
        }
      }
    })

    it('should call refetch when an item is updated', () => {
      // Arrange
      const mockData = [{ id: '1', name: 'Extension 1', api_endpoint: 'url1' }]
      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: mockData,
        isPending: false,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      render(<ApiBasedExtensionPage />)

      // Act - Click edit on the rendered item
      fireEvent.click(screen.getByText('common.operation.edit'))

      // Retrieve the onSaveCallback from the modal call and execute it
      const callArgs = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
      if (typeof callArgs === 'object' && callArgs !== null && 'onSaveCallback' in callArgs) {
        if (callArgs.onSaveCallback)
          callArgs.onSaveCallback()
      }

      // Assert
      expect(mockRefetch).toHaveBeenCalled()
    })
  })
})
