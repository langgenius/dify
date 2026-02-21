import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { useAppContext } from '@/context/app-context'
import PluginPage from './index'
import { updatePluginKey, validatePluginKey } from './utils'

const mockUsePluginProviders = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-common', () => ({
  usePluginProviders: mockUsePluginProviders,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: vi.fn(),
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: vi.fn(),
      useSubscription: vi.fn(),
    },
  }),
}))

vi.mock('./utils', () => ({
  updatePluginKey: vi.fn(),
  validatePluginKey: vi.fn(),
}))

describe('PluginPage', () => {
  const mockUpdatePluginKey = updatePluginKey as ReturnType<typeof vi.fn>
  const mockValidatePluginKey = validatePluginKey as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    const mockUseAppContext = useAppContext as ReturnType<typeof vi.fn>
    mockUseAppContext.mockReturnValue({
      isCurrentWorkspaceManager: true,
    })
    mockValidatePluginKey.mockResolvedValue({ status: 'success' })
    mockUpdatePluginKey.mockResolvedValue({ status: 'success' })
  })

  it('should render plugin settings with edit action when serpapi key exists', () => {
    mockUsePluginProviders.mockReturnValue({
      data: [
        { tool_name: 'serpapi', credentials: { api_key: 'test-key' } },
      ],
      refetch: vi.fn(),
    })

    render(<PluginPage />)
    expect(screen.getByText('common.provider.editKey')).toBeInTheDocument()
  })

  it('should render plugin settings with add action when serpapi key is missing', () => {
    mockUsePluginProviders.mockReturnValue({
      data: [
        { tool_name: 'serpapi', credentials: null },
      ],
      refetch: vi.fn(),
    })

    render(<PluginPage />)
    expect(screen.getByText('common.provider.addKey')).toBeInTheDocument()
  })

  it('should display encryption notice with PKCS1_OAEP link', () => {
    mockUsePluginProviders.mockReturnValue({
      data: [],
      refetch: vi.fn(),
    })

    render(<PluginPage />)
    expect(screen.getByText(/common\.provider\.encrypted\.front/)).toBeInTheDocument()
    expect(screen.getByText(/common\.provider\.encrypted\.back/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'PKCS1_OAEP' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('href', 'https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html')
  })

  it('should show reload state after saving key', async () => {
    let showReloadedState = () => {}
    const Wrapper = () => {
      const [reloaded, setReloaded] = useState(false)
      showReloadedState = () => setReloaded(true)
      return (
        <>
          <PluginPage />
          {reloaded && <div>providers-reloaded</div>}
        </>
      )
    }
    mockUsePluginProviders.mockImplementation(() => ({
      data: [{ tool_name: 'serpapi', credentials: { api_key: 'existing-key' } }],
      refetch: () => showReloadedState(),
    }))

    render(<Wrapper />)

    fireEvent.click(screen.getByText('common.provider.editKey'))
    fireEvent.change(screen.getByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder'), {
      target: { value: 'new-key' },
    })
    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(screen.getByText('providers-reloaded')).toBeInTheDocument()
    })
  })
})
