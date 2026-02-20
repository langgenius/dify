import type { PluginProvider } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useToastContext } from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import SerpapiPlugin from './SerpapiPlugin'
import { updatePluginKey, validatePluginKey } from './utils'

const mockNotify = vi.fn()
const mockEmit = vi.fn()
const mockUseSubscription = vi.fn()

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: vi.fn(() => ({
    notify: mockNotify,
  })),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('./utils', () => ({
  updatePluginKey: vi.fn(),
  validatePluginKey: vi.fn(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: vi.fn(() => ({
    eventEmitter: {
      useSubscription: mockUseSubscription,
      emit: mockEmit,
    },
  })),
}))

describe('SerpapiPlugin', () => {
  const mockOnUpdate = vi.fn()
  const basePlugin = {
    tool_name: 'serpapi',
    is_enabled: true,
  } as PluginProvider

  beforeEach(() => {
    vi.clearAllMocks()
    const mockUseAppContext = useAppContext as ReturnType<typeof vi.fn>
    mockUseAppContext.mockReturnValue({
      isCurrentWorkspaceManager: true,
    })
  })

  it('should open api key input when manager clicks add key', () => {
    render(<SerpapiPlugin plugin={{ ...basePlugin, credentials: null }} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText(/provider\.addKey/))

    expect(screen.getByPlaceholderText(/plugin\.serpapi\.apiKeyPlaceholder/)).toBeInTheDocument()
  })

  it('should not open key input for non-manager', () => {
    const mockUseAppContext = useAppContext as ReturnType<typeof vi.fn>
    mockUseAppContext.mockReturnValue({
      isCurrentWorkspaceManager: false,
    })

    render(<SerpapiPlugin plugin={{ ...basePlugin, credentials: null }} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText(/provider\.addKey/))

    expect(screen.queryByPlaceholderText(/plugin\.serpapi\.apiKeyPlaceholder/)).not.toBeInTheDocument()
  })

  it('should save a new api key and notify success', async () => {
    const mockUseToastContext = useToastContext as ReturnType<typeof vi.fn>
    mockUseToastContext.mockReturnValue({ notify: mockNotify })
    const mockUpdatePluginKey = updatePluginKey as ReturnType<typeof vi.fn>
    const mockValidatePluginKey = validatePluginKey as ReturnType<typeof vi.fn>
    mockValidatePluginKey.mockResolvedValue({ result: 'success' })
    mockUpdatePluginKey.mockResolvedValue({ status: 'success' })

    render(
      <SerpapiPlugin
        plugin={{ ...basePlugin, credentials: { api_key: 'old-key' } }}
        onUpdate={mockOnUpdate}
      />,
    )

    fireEvent.click(screen.getByText(/provider\.editKey/))
    fireEvent.focus(screen.getByPlaceholderText(/plugin\.serpapi\.apiKeyPlaceholder/))
    fireEvent.change(screen.getByPlaceholderText(/plugin\.serpapi\.apiKeyPlaceholder/), { target: { value: 'new-key' } })
    fireEvent.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockValidatePluginKey).toHaveBeenCalled()
      expect(mockUpdatePluginKey).toHaveBeenCalledWith('serpapi', {
        credentials: { api_key: 'new-key' },
      })
      expect(mockNotify).toHaveBeenCalled()
      expect(mockOnUpdate).toHaveBeenCalled()
      expect(mockEmit).toHaveBeenCalled()
    })
  })

  it('should not save when api key is unchanged', async () => {
    const mockUpdatePluginKey = updatePluginKey as ReturnType<typeof vi.fn>
    const mockValidatePluginKey = validatePluginKey as ReturnType<typeof vi.fn>
    mockValidatePluginKey.mockResolvedValue({ result: 'success' })

    render(
      <SerpapiPlugin
        plugin={{ ...basePlugin, credentials: { api_key: 'same-key' } }}
        onUpdate={mockOnUpdate}
      />,
    )

    fireEvent.click(screen.getByText(/provider\.editKey/))
    fireEvent.change(screen.getByPlaceholderText(/plugin\.serpapi\.apiKeyPlaceholder/), { target: { value: 'same-key' } })
    fireEvent.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockValidatePluginKey).not.toHaveBeenCalled()
      expect(mockUpdatePluginKey).not.toHaveBeenCalled()
      expect(mockOnUpdate).not.toHaveBeenCalled()
    })
  })
})
