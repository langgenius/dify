import type { UseQueryResult } from '@tanstack/react-query'
import type { ModalContextState } from '@/context/modal-context'
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

  it('renders placeholder when no value is selected', () => {
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    expect(screen.getByText('common.apiBasedExtension.selector.placeholder')).toBeInTheDocument()
  })

  it('renders placeholder when data is undefined', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: undefined,
      refetch: mockRefetch,
    } as unknown as UseQueryResult<ApiBasedExtension[], Error>)
    render(<ApiBasedExtensionSelector value="1" onChange={mockOnChange} />)
    expect(screen.getByText('common.apiBasedExtension.selector.placeholder')).toBeInTheDocument()
  })

  it('renders selected item name', () => {
    render(<ApiBasedExtensionSelector value="1" onChange={mockOnChange} />)
    const trigger = screen.getByTestId('portal-trigger')
    expect(within(trigger).getByText('Extension 1')).toBeInTheDocument()
    expect(within(trigger).getByText('https://api1.test')).toBeInTheDocument()
  })

  it('opens dropdown when clicked', () => {
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    const trigger = screen.getByTestId('portal-trigger')
    fireEvent.click(trigger)
    expect(screen.getByText('common.apiBasedExtension.selector.title')).toBeInTheDocument()
    expect(screen.getByText('Extension 1')).toBeInTheDocument()
    expect(screen.getByText('Extension 2')).toBeInTheDocument()

    // Check if portal root has open state (simulating visual state)
    expect(screen.getByTestId('portal-root')).toHaveAttribute('data-open', 'true')
  })

  it('calls onChange and closes dropdown when an extension is selected', () => {
    render(<ApiBasedExtensionSelector value="" onChange={mockOnChange} />)
    fireEvent.click(screen.getByTestId('portal-trigger'))

    // Click the option in the dropdown
    const options = screen.getAllByText('Extension 2')
    // The option in the dropdown is the one we want.
    // Since we simplified the mock, both trigger and content are in DOM separately.
    // We can rely on text.
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

    expect(mockSetShowApiBasedExtensionModal).toHaveBeenCalledWith({
      payload: {},
      onSaveCallback: expect.any(Function),
    })
    expect(screen.getByTestId('portal-root')).toHaveAttribute('data-open', 'false')

    // Verify refetch is called when onSaveCallback is executed
    const calls = mockSetShowApiBasedExtensionModal.mock.calls
    const lastCall = calls[calls.length - 1]
    const payload = lastCall[0]
    if (payload && typeof payload.onSaveCallback === 'function') {
      payload.onSaveCallback()
      expect(mockRefetch).toHaveBeenCalled()
    }
  })
})
