import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { TFunction } from 'i18next'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as reactI18next from 'react-i18next'
import { Item } from '../item'

const { mockDeleteApiBasedExtension } = vi.hoisted(() => ({
  mockDeleteApiBasedExtension: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apiBasedExtension: {
      byId: {
        delete: {
          mutationOptions: () => ({ mutationFn: mockDeleteApiBasedExtension }),
        },
      },
    },
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((options: { mutationFn: (variables: unknown) => Promise<unknown> }) => ({
    isPending: false,
    mutate: (variables: unknown, mutationOptions?: { onSuccess?: (data: unknown) => void }) => {
      options.mutationFn(variables).then(data => mutationOptions?.onSuccess?.(data))
    },
  })),
}))

describe('Item Component', () => {
  const mockData: ApiBasedExtensionResponse = {
    id: '1',
    name: 'Test Extension',
    api_endpoint: 'https://api.example.com',
    api_key: 'test-api-key',
  }
  const mockOnEdit = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render extension data correctly', () => {
      // Act
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)

      // Assert
      // Assert
      expect(screen.getByText('Test Extension'))!.toBeInTheDocument()
      expect(screen.getByText('https://api.example.com'))!.toBeInTheDocument()
    })

    it('should render with minimal extension data', () => {
      // Arrange
      const minimalData: ApiBasedExtensionResponse = {
        id: '2',
        name: '',
        api_endpoint: '',
        api_key: '',
      }

      // Act
      render(<Item apiBasedExtension={minimalData} onEdit={mockOnEdit} />)

      // Assert
      // Assert
      expect(screen.getByText('common.operation.edit'))!.toBeInTheDocument()
      expect(screen.getByText('common.operation.delete'))!.toBeInTheDocument()
    })
  })

  describe('Modal Interactions', () => {
    it('should request editing with the current extension when clicking edit button', () => {
      // Act
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)
      fireEvent.click(screen.getByText('common.operation.edit'))

      // Assert
      expect(mockOnEdit).toHaveBeenCalledWith(mockData)
    })
  })

  describe('Deletion', () => {
    it('should show delete confirmation dialog when clicking delete button', () => {
      // Act
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)
      fireEvent.click(screen.getByText('common.operation.delete'))

      // Assert
      // Assert
      expect(screen.getByText(/common\.operation\.delete.*Test Extension.*\?/i))!.toBeInTheDocument()
    })

    it('should call delete mutation when confirming deletion', async () => {
      // Arrange
      mockDeleteApiBasedExtension.mockResolvedValue({})
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)

      // Act
      fireEvent.click(screen.getByText('common.operation.delete'))
      const dialog = screen.getByRole('alertdialog', {
        name: /common\.operation\.delete.*Test Extension.*\?/i,
      })
      const confirmButton = within(dialog).getByRole('button', { name: 'common.operation.delete' })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(mockDeleteApiBasedExtension).toHaveBeenCalledWith({
          params: {
            id: '1',
          },
        })
      })
    })

    it('should hide delete confirmation dialog after successful deletion', async () => {
      // Arrange
      mockDeleteApiBasedExtension.mockResolvedValue({})
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)

      // Act
      fireEvent.click(screen.getByText('common.operation.delete'))
      const dialog = screen.getByRole('alertdialog', {
        name: /common\.operation\.delete.*Test Extension.*\?/i,
      })
      const confirmButton = within(dialog).getByRole('button', { name: 'common.operation.delete' })
      fireEvent.click(confirmButton)

      // Assert
      await waitFor(() => {
        expect(screen.queryByText(/common\.operation\.delete.*Test Extension.*\?/i)).not.toBeInTheDocument()
      })
    })

    it('should close delete confirmation when clicking cancel button', async () => {
      // Act
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)
      fireEvent.click(screen.getByText('common.operation.delete'))
      fireEvent.click(screen.getByText('common.operation.cancel'))

      // Assert
      await waitFor(() => {
        expect(screen.queryByText(/common\.operation\.delete.*Test Extension.*\?/i)).not.toBeInTheDocument()
      })
    })

    it('should not call delete API when canceling deletion', () => {
      // Act
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)
      fireEvent.click(screen.getByText('common.operation.delete'))
      fireEvent.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(mockDeleteApiBasedExtension).not.toHaveBeenCalled()
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
      render(<Item apiBasedExtension={mockData} onEdit={mockOnEdit} />)
      const allButtons = screen.getAllByRole('button')
      const editBtn = screen.getByText('operation.edit')
      const deleteBtn = allButtons.find(btn => btn !== editBtn)
      if (deleteBtn)
        fireEvent.click(deleteBtn)

      // Assert
      // Assert
      expect(screen.getByText(/.*Test Extension.*\?/i))!.toBeInTheDocument()

      useTranslationSpy.mockRestore()
    })
  })
})
