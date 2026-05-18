import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { addApiBasedExtension, updateApiBasedExtension } from '@/service/common'
import { useApiBasedExtensions } from '@/service/use-common'
import ApiBasedExtensionPage from '../index'

vi.mock('@/service/use-common', () => ({
  useApiBasedExtensions: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  addApiBasedExtension: vi.fn(),
  updateApiBasedExtension: vi.fn(),
}))

describe('ApiBasedExtensionPage', () => {
  const mockRefetch = vi.fn<() => void>()

  beforeEach(() => {
    vi.clearAllMocks()
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
      // Assert
      expect(screen.getByText('common.apiBasedExtension.title'))!.toBeInTheDocument()
    })

    it('should render list of extensions when data exists', () => {
      // Arrange
      const mockData: ApiBasedExtensionResponse[] = [
        { id: '1', name: 'Extension 1', api_endpoint: 'url1', api_key: 'key1' },
        { id: '2', name: 'Extension 2', api_endpoint: 'url2', api_key: 'key2' },
      ]

      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: mockData,
        isPending: false,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      // Act
      render(<ApiBasedExtensionPage />)

      // Assert
      // Assert
      expect(screen.getByText('Extension 1'))!.toBeInTheDocument()
      expect(screen.getByText('url1'))!.toBeInTheDocument()
      expect(screen.getByText('Extension 2'))!.toBeInTheDocument()
      expect(screen.getByText('url2'))!.toBeInTheDocument()
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
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      // Assert
      expect(screen.queryByText('common.apiBasedExtension.title')).not.toBeInTheDocument()
      expect(screen.getByText('common.apiBasedExtension.add'))!.toBeInTheDocument()
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
      expect(screen.getByRole('dialog', { name: 'common.apiBasedExtension.modal.title' })).toBeInTheDocument()
    })

    it('should call refetch when add modal saves successfully', async () => {
      // Arrange
      vi.mocked(addApiBasedExtension).mockResolvedValue({
        id: 'new-id',
        name: 'New Ext',
        api_endpoint: 'https://api.test',
        api_key: 'secret-key',
      })
      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: [],
        isPending: false,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      // Act
      render(<ApiBasedExtensionPage />)
      fireEvent.click(screen.getByText('common.apiBasedExtension.add'))
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'New Ext' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'https://api.test' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: 'secret-key' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })

    it('should call refetch when an item is updated', async () => {
      // Arrange
      const extension: ApiBasedExtensionResponse = { id: '1', name: 'Extension 1', api_endpoint: 'url1', api_key: 'long-api-key' }
      vi.mocked(updateApiBasedExtension).mockResolvedValue({ ...extension, name: 'Updated' })
      vi.mocked(useApiBasedExtensions).mockReturnValue({
        data: [extension],
        isPending: false,
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useApiBasedExtensions>)

      render(<ApiBasedExtensionPage />)

      // Act - Click edit on the rendered item
      fireEvent.click(screen.getByText('common.operation.edit'))
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })
})
