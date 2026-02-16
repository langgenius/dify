import type { UseQueryResult } from '@tanstack/react-query'
import type { ModalContextState } from '@/context/modal-context'
import type { ApiBasedExtension } from '@/models/common'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { useApiBasedExtensions } from '@/service/use-common'
import ApiBasedExtensionSelector from './selector'

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useApiBasedExtensions: vi.fn(),
}))

// Mocking Portal components to simplify testing
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => (
    <div data-testid="portal-root" data-open={open}>
      {children}
    </div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="portal-content">
      {children}
    </div>
  ),
}))

describe('ApiBasedExtensionSelector', () => {
  const mockOnChange = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()
  const mockSetShowApiBasedExtensionModal = vi.fn()
  const mockRefetch = vi.fn()

  const mockData: ApiBasedExtension[] = [
    { id: '1', name: 'Extension 1', api_endpoint: 'https://api1.test' },
    { id: '2', name: 'Extension 2', api_endpoint: 'https://api2.test' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContext).mockReturnValue({
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
      setShowApiBasedExtensionModal: mockSetShowApiBasedExtensionModal,
    } as unknown as ModalContextState)
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: mockData,
      refetch: mockRefetch,
    } as unknown as UseQueryResult<ApiBasedExtension[], Error>)
  })

  describe('Rendering', () => {
    it('should render placeholder when no value is selected', () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)

      // Assert
      expect(screen.getByText('common.apiBasedExtension.selector.placeholder')).toBeInTheDocument()
    })

    it('should render selected item name', () => {
      // Act
      render(<ApiBasedExtensionSelector value="1" onChange={mockOnChange} />)

      // Assert
      const trigger = screen.getByTestId('portal-trigger')
      expect(within(trigger).getByText('Extension 1')).toBeInTheDocument()
    })
  })

  describe('Dropdown Interactions', () => {
    it('should open dropdown when clicked', () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Assert
      expect(screen.getByText('common.apiBasedExtension.selector.title')).toBeInTheDocument()
      expect(screen.getByTestId('portal-root')).toHaveAttribute('data-open', 'true')
    })

    it('should call onChange and closes dropdown when an extension is selected', () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))
      const options = screen.getAllByText('Extension 2')
      fireEvent.click(options[0])

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith('2')
      expect(screen.getByTestId('portal-root')).toHaveAttribute('data-open', 'false')
    })
  })

  describe('Manage and Add Extensions', () => {
    it('should open account settings when clicking manage', () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))
      fireEvent.click(screen.getByText('common.apiBasedExtension.selector.manage'))

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: ACCOUNT_SETTING_TAB.API_BASED_EXTENSION,
      })
      expect(screen.getByTestId('portal-root')).toHaveAttribute('data-open', 'false')
    })

    it('should open add modal when clicking add button and refetches on save', () => {
      // Act
      render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))
      fireEvent.click(screen.getByText('common.operation.add'))

      // Assert
      expect(mockSetShowApiBasedExtensionModal).toHaveBeenCalledWith(expect.objectContaining({
        payload: {},
      }))

      // Trigger callback
      const lastCall = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
      if (typeof lastCall === 'object' && lastCall !== null && 'onSaveCallback' in lastCall) {
        if (lastCall.onSaveCallback) {
          lastCall.onSaveCallback()
          expect(mockRefetch).toHaveBeenCalled()
        }
      }
    })
  })
})
