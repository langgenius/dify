import type { AccessMode } from '@/models/access-control'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import TextGeneration from '@/app/components/share/text-generation'

const useSearchParamsMock = vi.fn(() => new URLSearchParams())

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => useSearchParamsMock(),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: vi.fn(() => 'pc'),
  MediaType: { pc: 'pc', pad: 'pad', mobile: 'mobile' },
}))

vi.mock('@/hooks/use-app-favicon', () => ({
  useAppFavicon: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/i18n-config/client', () => ({
  changeLanguage: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/app/components/share/text-generation/run-once', () => ({
  default: ({
    inputs,
    onInputsChange,
    onSend,
    runControl,
  }: {
    inputs: Record<string, unknown>
    onInputsChange: (inputs: Record<string, unknown>) => void
    onSend: () => void
    runControl?: { isStopping: boolean } | null
  }) => (
    <div data-testid="run-once-mock">
      <span data-testid="run-once-input-name">{String(inputs.name ?? '')}</span>
      <button onClick={() => onInputsChange({ ...inputs, name: 'Gamma' })}>change-inputs</button>
      <button onClick={onSend}>run-once</button>
      <span>{runControl ? 'stop-ready' : 'idle'}</span>
    </div>
  ),
}))

vi.mock('@/app/components/share/text-generation/run-batch', () => ({
  default: ({ onSend }: { onSend: (data: string[][]) => void }) => (
    <button
      onClick={() => onSend([
        ['Name'],
        ['Alpha'],
        ['Beta'],
      ])}
    >
      run-batch
    </button>
  ),
}))

vi.mock('@/app/components/app/text-generate/saved-items', () => ({
  default: ({ list }: { list: { id: string }[] }) => <div data-testid="saved-items-mock">{list.length}</div>,
}))

vi.mock('@/app/components/share/text-generation/menu-dropdown', () => ({
  default: () => <div data-testid="menu-dropdown-mock" />,
}))

vi.mock('@/app/components/share/text-generation/result', () => {
  const MockResult = ({
    isCallBatchAPI,
    onRunControlChange,
    onRunStart,
    taskId,
  }: {
    isCallBatchAPI: boolean
    onRunControlChange?: (control: { onStop: () => void, isStopping: boolean } | null) => void
    onRunStart: () => void
    taskId?: number
  }) => {
    const runControlRef = React.useRef(false)

    React.useEffect(() => {
      onRunStart()
    }, [onRunStart])

    React.useEffect(() => {
      if (!isCallBatchAPI && !runControlRef.current) {
        runControlRef.current = true
        onRunControlChange?.({ onStop: vi.fn(), isStopping: false })
      }
    }, [isCallBatchAPI, onRunControlChange])

    return <div data-testid={taskId ? `result-task-${taskId}` : 'result-single'} />
  }

  return {
    default: MockResult,
  }
})

const fetchSavedMessageMock = vi.fn()

vi.mock('@/service/share', async () => {
  const actual = await vi.importActual<typeof import('@/service/share')>('@/service/share')
  return {
    ...actual,
    fetchSavedMessage: (...args: Parameters<typeof actual.fetchSavedMessage>) => fetchSavedMessageMock(...args),
    removeMessage: vi.fn(),
    saveMessage: vi.fn(),
  }
})

const mockSystemFeatures = {
  branding: {
    enabled: false,
    workspace_logo: null,
  },
}

const mockWebAppState = {
  appInfo: {
    app_id: 'app-123',
    site: {
      title: 'Text Generation',
      description: 'Share description',
      default_language: 'en-US',
      icon_type: 'emoji',
      icon: 'robot',
      icon_background: '#fff',
      icon_url: '',
    },
    custom_config: {
      remove_webapp_brand: false,
      replace_webapp_logo: '',
    },
  },
  appParams: {
    user_input_form: [
      {
        'text-input': {
          label: 'Name',
          variable: 'name',
          required: true,
          max_length: 48,
          default: '',
          hide: false,
        },
      },
    ],
    more_like_this: {
      enabled: true,
    },
    file_upload: {
      enabled: false,
      number_limits: 2,
      detail: 'low',
      allowed_upload_methods: ['local_file'],
    },
    text_to_speech: {
      enabled: true,
    },
    system_parameters: {
      image_file_size_limit: 10,
    },
  },
  webAppAccessMode: 'public' as AccessMode,
}

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: typeof mockSystemFeatures }) => unknown) =>
    selector({ systemFeatures: mockSystemFeatures }),
}))

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: typeof mockWebAppState) => unknown) => selector(mockWebAppState),
}))

describe('TextGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSearchParamsMock.mockReturnValue(new URLSearchParams())
    fetchSavedMessageMock.mockResolvedValue({
      data: [{ id: 'saved-1' }, { id: 'saved-2' }],
    })
  })

  it('should switch between create, batch, and saved tabs after app state loads', async () => {
    render(<TextGeneration />)

    await waitFor(() => {
      expect(screen.getByTestId('run-once-mock')).toBeInTheDocument()
    })
    expect(screen.getByTestId('run-once-input-name')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('button', { name: 'change-inputs' }))
    await waitFor(() => {
      expect(screen.getByTestId('run-once-input-name')).toHaveTextContent('Gamma')
    })

    fireEvent.click(screen.getByTestId('tab-header-item-batch'))
    expect(screen.getByRole('button', { name: 'run-batch' })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tab-header-item-saved'))
    expect(screen.getByTestId('saved-items-mock')).toHaveTextContent('2')

    fireEvent.click(screen.getByTestId('tab-header-item-create'))
    expect(screen.getByTestId('run-once-mock')).toBeInTheDocument()
  })

  it('should wire single-run stop control and clear it when batch execution starts', async () => {
    render(<TextGeneration />)

    await waitFor(() => {
      expect(screen.getByTestId('run-once-mock')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'run-once' }))
    await waitFor(() => {
      expect(screen.getByText('stop-ready')).toBeInTheDocument()
    })
    expect(screen.getByTestId('result-single')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tab-header-item-batch'))
    fireEvent.click(screen.getByRole('button', { name: 'run-batch' }))
    await waitFor(() => {
      expect(screen.getByText('idle')).toBeInTheDocument()
    })
    expect(screen.getByTestId('result-task-1')).toBeInTheDocument()
    expect(screen.getByTestId('result-task-2')).toBeInTheDocument()
  })
})
