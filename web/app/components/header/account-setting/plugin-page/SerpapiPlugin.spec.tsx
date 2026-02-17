import type { PluginProvider } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import { useAppContext } from '@/context/app-context'
import SerpapiPlugin from './SerpapiPlugin'

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: vi.fn(() => ({
    notify: vi.fn(),
  })),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => (
    <div aria-label={alt} />
  ),
}))

vi.mock('./utils', () => ({
  updatePluginKey: vi.fn(),
  validatePluginKey: vi.fn(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: vi.fn(() => ({
    eventEmitter: {
      useSubscription: vi.fn(),
      emit: vi.fn(),
    },
  })),
}))

describe('SerpapiPlugin', () => {
  const mockOnUpdate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    const mockUseAppContext = useAppContext as ReturnType<typeof vi.fn>
    mockUseAppContext.mockReturnValue({
      isCurrentWorkspaceManager: true,
    })
  })

  it('should render serpapi plugin with credentials', () => {
    const mockPlugin: PluginProvider = {
      tool_name: 'serpapi',
      credentials: {
        api_key: 'existing-key',
      },
    } as PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)
    expect(screen.getByLabelText('serpapi logo')).toBeInTheDocument()
  })

  it('should render serpapi plugin without credentials', () => {
    const mockPlugin = {
      tool_name: 'serpapi',
      is_enabled: true,
      credentials: null,
    } satisfies PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)
    expect(screen.getByLabelText('serpapi logo')).toBeInTheDocument()
  })

  it('should open key input when clicking edit for existing key', () => {
    const mockPlugin: PluginProvider = {
      tool_name: 'serpapi',
      credentials: {
        api_key: 'existing-key',
      },
    } as PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('provider.editKey'))

    expect(screen.getByPlaceholderText('plugin.serpapi.apiKeyPlaceholder')).toBeInTheDocument()
  })

  it('should open key input when clicking add for missing key', () => {
    const mockPlugin = {
      tool_name: 'serpapi',
      is_enabled: true,
      credentials: null,
    } satisfies PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('provider.addKey'))

    expect(screen.getByPlaceholderText('plugin.serpapi.apiKeyPlaceholder')).toBeInTheDocument()
  })

  it('should not open key input when user is not workspace manager', () => {
    const mockUseAppContext = useAppContext as ReturnType<typeof vi.fn>
    mockUseAppContext.mockReturnValue({
      isCurrentWorkspaceManager: false,
    })

    const mockPlugin = {
      tool_name: 'serpapi',
      is_enabled: true,
      credentials: null,
    } satisfies PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('provider.addKey'))

    expect(screen.queryByPlaceholderText('plugin.serpapi.apiKeyPlaceholder')).not.toBeInTheDocument()
  })
})
