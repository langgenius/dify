import type { PluginProvider } from '@/models/common'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useToastContext } from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import SerpapiPlugin from './SerpapiPlugin'
import { updatePluginKey, validatePluginKey } from './utils'

const mockEventEmitter = vi.hoisted(() => {
  let subscriber: ((value: string) => void) | undefined
  return {
    useSubscription: vi.fn((callback: (value: string) => void) => {
      subscriber = callback
    }),
    emit: vi.fn((value: string) => {
      subscriber?.(value)
    }),
    reset: () => {
      subscriber = undefined
    },
  }
})

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: vi.fn(),
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
    eventEmitter: mockEventEmitter,
  })),
}))

describe('SerpapiPlugin', () => {
  const mockOnUpdate = vi.fn()
  const mockNotify = vi.fn()
  const mockUpdatePluginKey = updatePluginKey as ReturnType<typeof vi.fn>
  const mockValidatePluginKey = validatePluginKey as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockEventEmitter.reset()
    const mockUseAppContext = useAppContext as ReturnType<typeof vi.fn>
    const mockUseToastContext = useToastContext as ReturnType<typeof vi.fn>
    mockUseAppContext.mockReturnValue({
      isCurrentWorkspaceManager: true,
    })
    mockUseToastContext.mockReturnValue({
      notify: mockNotify,
    })
    mockValidatePluginKey.mockResolvedValue({ status: 'success' })
    mockUpdatePluginKey.mockResolvedValue({ status: 'success' })
  })

  it('should show key input when manager clicks edit key', () => {
    const mockPlugin: PluginProvider = {
      tool_name: 'serpapi',
      credentials: {
        api_key: 'existing-key',
      },
    } as PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.provider.editKey'))
    expect(screen.getByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder')).toBeInTheDocument()
  })

  it('should clear existing key on focus and show validation error for invalid key', async () => {
    vi.useFakeTimers()
    try {
      mockValidatePluginKey.mockResolvedValue({ status: 'error', message: 'Invalid API key' })

      const mockPlugin: PluginProvider = {
        tool_name: 'serpapi',
        credentials: {
          api_key: 'existing-key',
        },
      } as PluginProvider

      render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)

      fireEvent.click(screen.getByText('common.provider.editKey'))
      const input = screen.getByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder')

      expect(input).toHaveValue('existing-key')
      fireEvent.focus(input)
      expect(input).toHaveValue('')

      fireEvent.change(input, {
        target: { value: 'invalid-key' },
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(screen.getByText(/Invalid API key/)).toBeInTheDocument()

      fireEvent.focus(input)
      expect(input).toHaveValue('invalid-key')

      fireEvent.change(input, {
        target: { value: '' },
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(screen.queryByText(/Invalid API key/)).toBeNull()
    }
    finally {
      vi.useRealTimers()
    }
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

    fireEvent.click(screen.getByText('common.provider.addKey'))

    expect(screen.queryByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder')).toBeNull()
  })

  it('should save changed key and trigger success feedback', async () => {
    const mockPlugin: PluginProvider = {
      tool_name: 'serpapi',
      credentials: {
        api_key: 'existing-key',
      },
    } as PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.provider.editKey'))
    fireEvent.change(screen.getByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder'), {
      target: { value: 'new-key' },
    })
    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder')).toBeNull()
    })
  })

  it('should keep editor open when save request fails', async () => {
    mockUpdatePluginKey.mockResolvedValue({ status: 'error', message: 'update failed' })

    const mockPlugin: PluginProvider = {
      tool_name: 'serpapi',
      credentials: {
        api_key: 'existing-key',
      },
    } as PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.provider.editKey'))
    fireEvent.change(screen.getByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder'), {
      target: { value: 'new-key' },
    })
    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder')).toBeInTheDocument()
    })
  })

  it('should keep editor open when key value is unchanged', async () => {
    const mockPlugin: PluginProvider = {
      tool_name: 'serpapi',
      credentials: {
        api_key: 'existing-key',
      },
    } as PluginProvider

    render(<SerpapiPlugin plugin={mockPlugin} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.provider.editKey'))
    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('common.plugin.serpapi.apiKeyPlaceholder')).toBeInTheDocument()
    })
  })
})
