import type { SetStateAction } from 'react'
import type { ModalState } from '@/context/modal-context'
import type { ApiBasedExtension } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useModalContext } from '@/context/modal-context'
import { useApiBasedExtensions } from '@/service/use-common'
import Empty from './empty'
import ApiBasedExtensionPage from './index'
import Item from './item'

vi.mock('@/service/use-common', () => ({
  useApiBasedExtensions: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('./empty', () => ({
  default: vi.fn(() => <div>Empty Component</div>),
}))

vi.mock('./item', () => ({
  default: vi.fn(() => <div>Item Component</div>),
}))

describe('ApiBasedExtensionPage', () => {
  const mockRefetch = vi.fn<() => void>()
  const mockSetShowApiBasedExtensionModal = vi.fn<(value: SetStateAction<ModalState<ApiBasedExtension> | null>) => void>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContext).mockReturnValue({
      setShowAccountSettingModal: vi.fn(),
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
  })

  it('renders empty state when no data exists', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: [],
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    expect(Empty).toHaveBeenCalled()
    expect(screen.getByText('Empty Component')).toBeInTheDocument()
  })

  it('renders list of extensions when data exists', () => {
    const mockData = [
      { id: '1', name: 'Extension 1', api_endpoint: 'url1' },
      { id: '2', name: 'Extension 2', api_endpoint: 'url2' },
    ]

    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: mockData,
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    expect(Item).toHaveBeenCalledTimes(2)

    const firstCallProps = vi.mocked(Item).mock.calls[0][0]
    expect(firstCallProps.data).toEqual(mockData[0])
    expect(firstCallProps.onUpdate).toBeInstanceOf(Function)
  })

  it('does not render Empty component when data exists', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: [{ id: '1', name: 'Extension 1', api_endpoint: 'url1' }],
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    expect(screen.queryByText('Empty Component')).not.toBeInTheDocument()
  })

  it('opens modal when clicking add button', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: [],
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    fireEvent.click(screen.getByText('common.apiBasedExtension.add'))

    expect(mockSetShowApiBasedExtensionModal).toHaveBeenCalledWith(expect.objectContaining({
      payload: {},
    }))
    const lastCall = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
    if (typeof lastCall === 'object' && lastCall !== null && 'onSaveCallback' in lastCall)
      expect(lastCall.onSaveCallback).toBeInstanceOf(Function)
  })

  it('calls refetch when onSaveCallback is executed', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: [],
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    fireEvent.click(screen.getByText('common.apiBasedExtension.add'))

    const callArgs = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
    if (typeof callArgs === 'object' && callArgs !== null && 'onSaveCallback' in callArgs) {
      if (callArgs.onSaveCallback) {
        callArgs.onSaveCallback()
        expect(mockRefetch).toHaveBeenCalled()
      }
    }
  })

  it('calls refetch when Item onUpdate callback is executed', () => {
    const mockData = [{ id: '1', name: 'Extension 1', api_endpoint: 'url1' }]

    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: mockData,
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    const itemProps = vi.mocked(Item).mock.calls[0][0]
    if (itemProps && typeof itemProps.onUpdate === 'function') {
      itemProps.onUpdate()
      expect(mockRefetch).toHaveBeenCalled()
    }
  })

  it('renders nothing while loading', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: null,
      isPending: true,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    expect(Empty).not.toHaveBeenCalled()
    expect(Item).not.toHaveBeenCalled()
  })
})
