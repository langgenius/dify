import type { AppData } from '@/models/share'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextGeneration from './text-generation'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'tryApp.tryInfo': 'This is a try app notice',
      }
      return translations[key] || key
    },
  }),
}))

const mockUpdateAppInfo = vi.fn()
const mockUpdateAppParams = vi.fn()
const mockAppParams = {
  user_input_form: [],
  more_like_this: { enabled: false },
  file_upload: null,
  text_to_speech: { enabled: false },
  system_parameters: {},
}
let mockStoreAppParams: typeof mockAppParams | null = mockAppParams

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: unknown) => unknown) => {
    const state = {
      updateAppInfo: mockUpdateAppInfo,
      updateAppParams: mockUpdateAppParams,
      appParams: mockStoreAppParams,
    }
    return selector(state)
  },
}))

const mockUseGetTryAppParams = vi.fn()

vi.mock('@/service/use-try-app', () => ({
  useGetTryAppParams: (...args: unknown[]) => mockUseGetTryAppParams(...args),
}))

let mockMediaType = 'pc'

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => mockMediaType,
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

vi.mock('@/app/components/share/text-generation/run-once', () => ({
  default: ({
    siteInfo,
    onSend,
    onInputsChange,
  }: { siteInfo: { title: string }, onSend: () => void, onInputsChange: (inputs: Record<string, unknown>) => void }) => (
    <div data-testid="run-once">
      <span data-testid="site-title">{siteInfo?.title}</span>
      <button data-testid="send-button" onClick={onSend}>Send</button>
      <button data-testid="inputs-change-button" onClick={() => onInputsChange({ testInput: 'testValue' })}>Change Inputs</button>
    </div>
  ),
}))

vi.mock('@/app/components/share/text-generation/result', () => ({
  default: ({
    isWorkflow,
    appId,
    onCompleted,
    onRunStart,
  }: { isWorkflow: boolean, appId: string, onCompleted: () => void, onRunStart: () => void }) => (
    <div data-testid="result-component" data-is-workflow={isWorkflow} data-app-id={appId}>
      <button data-testid="complete-button" onClick={onCompleted}>Complete</button>
      <button data-testid="run-start-button" onClick={onRunStart}>Run Start</button>
    </div>
  ),
}))

const createMockAppData = (overrides: Partial<AppData> = {}): AppData => ({
  app_id: 'test-app-id',
  site: {
    title: 'Test App Title',
    description: 'Test App Description',
    icon: '🚀',
    icon_type: 'emoji',
    icon_background: '#FFFFFF',
    icon_url: '',
    default_language: 'en',
    prompt_public: true,
    copyright: '',
    privacy_policy: '',
    custom_disclaimer: '',
  },
  custom_config: {
    remove_webapp_brand: false,
  },
  ...overrides,
} as AppData)

describe('TextGeneration', () => {
  beforeEach(() => {
    mockStoreAppParams = mockAppParams
    mockMediaType = 'pc'
    mockUseGetTryAppParams.mockReturnValue({
      data: mockAppParams,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('renders loading when appData is null', () => {
      render(
        <TextGeneration
          appId="test-app-id"
          appData={null}
        />,
      )

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('renders loading when appParams is not available', () => {
      mockStoreAppParams = null
      mockUseGetTryAppParams.mockReturnValue({
        data: null,
      })

      render(
        <TextGeneration
          appId="test-app-id"
          appData={createMockAppData()}
        />,
      )

      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  describe('content rendering', () => {
    it('renders app title', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        // Multiple elements may have the title (header and RunOnce mock)
        const titles = screen.getAllByText('Test App Title')
        expect(titles.length).toBeGreaterThan(0)
      })
    })

    it('renders app description when available', async () => {
      const appData = createMockAppData({
        site: {
          title: 'Test App',
          description: 'This is a description',
          icon: '🚀',
          icon_type: 'emoji',
          icon_background: '#FFFFFF',
          icon_url: '',
          default_language: 'en',
          prompt_public: true,
          copyright: '',
          privacy_policy: '',
          custom_disclaimer: '',
        },
      } as unknown as Partial<AppData>)

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('This is a description')).toBeInTheDocument()
      })
    })

    it('renders RunOnce component', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(screen.getByTestId('run-once')).toBeInTheDocument()
      })
    })

    it('renders Result component', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(screen.getByTestId('result-component')).toBeInTheDocument()
      })
    })
  })

  describe('workflow mode', () => {
    it('passes isWorkflow=true to Result when isWorkflow prop is true', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
          isWorkflow
        />,
      )

      await waitFor(() => {
        const resultComponent = screen.getByTestId('result-component')
        expect(resultComponent).toHaveAttribute('data-is-workflow', 'true')
      })
    })

    it('passes isWorkflow=false to Result when isWorkflow prop is false', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
          isWorkflow={false}
        />,
      )

      await waitFor(() => {
        const resultComponent = screen.getByTestId('result-component')
        expect(resultComponent).toHaveAttribute('data-is-workflow', 'false')
      })
    })
  })

  describe('send functionality', () => {
    it('triggers send when RunOnce sends', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(screen.getByTestId('send-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('send-button'))

      // The send should work without errors
      expect(screen.getByTestId('result-component')).toBeInTheDocument()
    })
  })

  describe('completion handling', () => {
    it('shows alert after completion', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(screen.getByTestId('complete-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('complete-button'))

      await waitFor(() => {
        expect(screen.getByText('This is a try app notice')).toBeInTheDocument()
      })
    })
  })

  describe('className prop', () => {
    it('applies custom className', async () => {
      const appData = createMockAppData()

      const { container } = render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
          className="custom-class"
        />,
      )

      await waitFor(() => {
        const element = container.querySelector('.custom-class')
        expect(element).toBeInTheDocument()
      })
    })
  })

  describe('hook effects', () => {
    it('calls updateAppInfo when appData changes', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(mockUpdateAppInfo).toHaveBeenCalledWith(appData)
      })
    })

    it('calls updateAppParams when tryAppParams changes', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(mockUpdateAppParams).toHaveBeenCalledWith(mockAppParams)
      })
    })

    it('calls useGetTryAppParams with correct appId', () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="my-app-id"
          appData={appData}
        />,
      )

      expect(mockUseGetTryAppParams).toHaveBeenCalledWith('my-app-id')
    })
  })

  describe('result panel visibility', () => {
    it('shows result panel after run starts', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(screen.getByTestId('run-start-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('run-start-button'))

      // Result panel should remain visible
      expect(screen.getByTestId('result-component')).toBeInTheDocument()
    })
  })

  describe('input handling', () => {
    it('handles input changes from RunOnce', async () => {
      const appData = createMockAppData()

      render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        expect(screen.getByTestId('inputs-change-button')).toBeInTheDocument()
      })

      // Trigger input change which should call setInputs callback
      fireEvent.click(screen.getByTestId('inputs-change-button'))

      // The component should handle the input change without errors
      expect(screen.getByTestId('run-once')).toBeInTheDocument()
    })
  })

  describe('mobile behavior', () => {
    it('renders mobile toggle panel on mobile', async () => {
      mockMediaType = 'mobile'
      const appData = createMockAppData()

      const { container } = render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        // Mobile toggle panel should be rendered
        const togglePanel = container.querySelector('.cursor-grab')
        expect(togglePanel).toBeInTheDocument()
      })
    })

    it('toggles result panel visibility on mobile', async () => {
      mockMediaType = 'mobile'
      const appData = createMockAppData()

      const { container } = render(
        <TextGeneration
          appId="test-app-id"
          appData={appData}
        />,
      )

      await waitFor(() => {
        const togglePanel = container.querySelector('.cursor-grab')
        expect(togglePanel).toBeInTheDocument()
      })

      // Click to show result panel
      const toggleParent = container.querySelector('.cursor-grab')?.parentElement
      if (toggleParent) {
        fireEvent.click(toggleParent)
      }

      // Click again to hide result panel
      await waitFor(() => {
        const newToggleParent = container.querySelector('.cursor-grab')?.parentElement
        if (newToggleParent) {
          fireEvent.click(newToggleParent)
        }
      })

      // Component should handle both show and hide without errors
      expect(screen.getByTestId('result-component')).toBeInTheDocument()
    })
  })
})
