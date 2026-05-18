import type { UseQueryResult } from '@tanstack/react-query'
import type { ModalContextState } from '@/context/modal-context'
import type { ApiBasedExtension } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { addApiBasedExtension } from '@/service/common'
import { useApiBasedExtensions } from '@/service/use-common'
import ApiBasedExtensionSelector from '../selector'

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useApiBasedExtensions: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  addApiBasedExtension: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/popover', async () => await import('@/__mocks__/base-ui-popover'))

describe('ApiBasedExtensionSelector', () => {
  const mockOnChange = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()
  const mockRefetch = vi.fn()

  const mockData: ApiBasedExtension[] = [
    { id: '1', name: 'Extension 1', api_endpoint: 'https://api1.test' },
    { id: '2', name: 'Extension 2', api_endpoint: 'https://api2.test' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContext).mockReturnValue({
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: mockData,
      refetch: mockRefetch,
      isPending: false,
      isError: false,
    } as unknown as UseQueryResult<ApiBasedExtension[], Error>)
  })

  describe('Rendering', () => {
    it('should render placeholder when no value is selected', () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)

      // Assert
      // Assert
      expect(screen.getByText('common.apiBasedExtension.selector.placeholder'))!.toBeInTheDocument()
    })

    it('should render selected item name', async () => {
      // Act
      render(<ApiBasedExtensionSelector value="1" onChange={mockOnChange} />)

      // Assert
      // Assert
      expect(screen.getByText('Extension 1'))!.toBeInTheDocument()
    })
  })

  describe('Dropdown Interactions', () => {
    it('should open dropdown when clicked', async () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
      const trigger = screen.getByText('common.apiBasedExtension.selector.placeholder')
      fireEvent.click(trigger)

      // Assert
      // Assert
      expect(await screen.findByText('common.apiBasedExtension.selector.title'))!.toBeInTheDocument()
    })

    it('should call onChange and closes dropdown when an extension is selected', async () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
      fireEvent.click(screen.getByText('common.apiBasedExtension.selector.placeholder'))

      const option = await screen.findByText('Extension 2')
      fireEvent.click(option)

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith('2')
    })
  })

  describe('Manage and Add Extensions', () => {
    it('should open account settings when clicking manage', async () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
      fireEvent.click(screen.getByText('common.apiBasedExtension.selector.placeholder'))

      const manageButton = await screen.findByText('common.apiBasedExtension.selector.manage')
      fireEvent.click(manageButton)

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: ACCOUNT_SETTING_TAB.API_BASED_EXTENSION,
      })
    })

    it('should open add modal when clicking add button and refetches on save', async () => {
      // Arrange
      vi.mocked(addApiBasedExtension).mockResolvedValue({ id: 'new-id' })

      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
      fireEvent.click(screen.getByText('common.apiBasedExtension.selector.placeholder'))

      const addButton = await screen.findByText('common.operation.add')
      fireEvent.click(addButton)
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'New Ext' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'https://api.test' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: 'secret-key' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })
})
