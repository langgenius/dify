import type { UseQueryResult } from '@tanstack/react-query'
import type { SetStateAction } from 'react'
import type { ModalState } from '@/context/modal-context'
import type { ApiBasedExtension } from '@/models/common'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
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
  const mockOnChange = vi.fn<(id: string) => void>()
  const mockSetShowAccountSettingModal = vi.fn()
  const mockSetShowApiBasedExtensionModal = vi.fn<(value: SetStateAction<ModalState<ApiBasedExtension> | null>) => void>()
  const mockRefetch = vi.fn<() => void>()

  const mockData: ApiBasedExtension[] = [
    { id: '1', name: 'Extension 1', api_endpoint: 'https://api1.test' },
    { id: '2', name: 'Extension 2', api_endpoint: 'https://api2.test' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContext).mockReturnValue({
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
      setShowApiBasedExtensionModal: mockSetShowApiBasedExtensionModal,
      setShowModerationSettingModal: vi.fn(),
      setShowExternalDataToolModal: vi.fn(),
      setShowPricingModal: vi.fn(),
      setShowAnnotationFullModal: vi.fn(),
      setShowModelModal: vi.fn(),
      setShowExternalKnowledgeAPIModal: vi.fn(),
      setShowModelLoadBalancingModal: vi.fn(),
      setShowOpeningModal: vi.fn(),
      setShowUpdatePluginModal: vi.fn(),
      setShowEducationExpireNoticeModal: vi.fn(),
      setShowTriggerEventsLimitModal: vi.fn(),
    })
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: mockData,
      refetch: mockRefetch,
    } as unknown as UseQueryResult<ApiBasedExtension[], Error>)
  })

  it('renders placeholder when no value is selected', () => {
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    expect(screen.getByText('common.apiBasedExtension.selector.placeholder')).toBeInTheDocument()
  })

  it('renders selected item name', () => {
    render(<ApiBasedExtensionSelector value="1" onChange={mockOnChange} />)
    const trigger = screen.getByTestId('portal-trigger')
    expect(within(trigger).getByText('Extension 1')).toBeInTheDocument()
  })

  it('opens dropdown when clicked', () => {
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    const trigger = screen.getByTestId('portal-trigger')
    fireEvent.click(trigger)
    expect(screen.getByText('common.apiBasedExtension.selector.title')).toBeInTheDocument()
    expect(screen.getByTestId('portal-root')).toHaveAttribute('data-open', 'true')
  })

  it('calls onChange and closes dropdown when an extension is selected', () => {
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    fireEvent.click(screen.getByTestId('portal-trigger'))

    const options = screen.getAllByText('Extension 2')
    fireEvent.click(options[0])

    expect(mockOnChange).toHaveBeenCalledWith('2')
    expect(screen.getByTestId('portal-root')).toHaveAttribute('data-open', 'false')
  })

  it('opens account settings when clicking manage', () => {
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    fireEvent.click(screen.getByTestId('portal-trigger'))
    fireEvent.click(screen.getByText('common.apiBasedExtension.selector.manage'))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.API_BASED_EXTENSION,
    })
    expect(screen.getByTestId('portal-root')).toHaveAttribute('data-open', 'false')
  })

  it('opens add modal when clicking add button and refetches on save', () => {
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    fireEvent.click(screen.getByTestId('portal-trigger'))
    fireEvent.click(screen.getByText('common.operation.add'))

    expect(mockSetShowApiBasedExtensionModal).toHaveBeenCalledWith(expect.objectContaining({
      payload: {},
    }))

    const lastCall = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
    if (typeof lastCall === 'object' && lastCall !== null && 'onSaveCallback' in lastCall) {
      if (lastCall.onSaveCallback) {
        lastCall.onSaveCallback()
        expect(mockRefetch).toHaveBeenCalled()
      }
    }
  })
})
