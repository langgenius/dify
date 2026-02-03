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
  const mockRefetch = vi.fn()
  const mockSetShowApiBasedExtensionModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContext).mockReturnValue({
      setShowApiBasedExtensionModal: mockSetShowApiBasedExtensionModal,
    } as unknown as ReturnType<typeof useModalContext>)
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

    const secondCallProps = vi.mocked(Item).mock.calls[1][0]
    expect(secondCallProps.data).toEqual(mockData[1])
    expect(secondCallProps.onUpdate).toBeInstanceOf(Function)
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

  it('does not render Item components when no data exists', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: [],
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    expect(Item).not.toHaveBeenCalled()
  })

  it('opens modal when clicking add button', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: [],
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    fireEvent.click(screen.getByText('common.apiBasedExtension.add'))

    expect(mockSetShowApiBasedExtensionModal).toHaveBeenCalledWith({
      payload: {},
      onSaveCallback: expect.any(Function),
    })
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
    callArgs.onSaveCallback()

    expect(mockRefetch).toHaveBeenCalled()
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
    itemProps.onUpdate()

    expect(mockRefetch).toHaveBeenCalled()
  })

  it('renders add button with correct text', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: [],
      isPending: false,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    expect(screen.getByText('common.apiBasedExtension.add')).toBeInTheDocument()
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

  it('does not render Empty or Items while loading even with data', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: [{ id: '1', name: 'Extension 1', api_endpoint: 'url1' }],
      isPending: true,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    expect(Empty).not.toHaveBeenCalled()
    expect(Item).not.toHaveBeenCalled()
  })

  it('renders add button even while loading', () => {
    vi.mocked(useApiBasedExtensions).mockReturnValue({
      data: null,
      isPending: true,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiBasedExtensions>)

    render(<ApiBasedExtensionPage />)

    expect(screen.getByText('common.apiBasedExtension.add')).toBeInTheDocument()
  })
})
