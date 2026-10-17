import type { AppData } from '@/models/share'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import TextGeneration from '../text-generation'

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
  }: {
    siteInfo: { title: string }
    onSend: () => void
    onInputsChange: (inputs: Record<string, unknown>) => void
  }) => (
    <div data-testid="run-once">
      <span data-testid="site-title">{siteInfo?.title}</span>
      <button data-testid="send-button" onClick={onSend}>
        Send
      </button>
      <button
        data-testid="inputs-change-button"
        onClick={() => onInputsChange({ testInput: 'testValue' })}
      >
        Change Inputs
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/share/text-generation/result', () => ({
  default: ({
    isWorkflow,
    appId,
    onCompleted,
    inputs,
    controlSend,
  }: {
    isWorkflow: boolean
    appId: string
    onCompleted: () => void
    inputs: Record<string, unknown>
    controlSend: number
  }) => (
    <div data-testid="result-component" data-is-workflow={isWorkflow} data-app-id={appId}>
      <button data-testid="complete-button" onClick={onCompleted}>
        Complete
      </button>
      <output aria-label="Submitted inputs">{JSON.stringify(inputs)}</output>
      <output aria-label="Generation requested">{String(controlSend > 0)}</output>
    </div>
  ),
}))

const createMockAppData = (overrides: Partial<AppData> = {}): AppData =>
  ({
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
  }) as AppData

describe('TextGeneration', () => {
  beforeEach(() => {
    mockStoreAppParams = mockAppParams
    mockMediaType = 'pc'
    mockUseGetTryAppParams.mockReturnValue({ data: mockAppParams })
  })

  it('waits for app details and parameters before showing the generation form', () => {
    const { rerender } = render(<TextGeneration appId="test-app-id" appData={null} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()

    mockStoreAppParams = null
    mockUseGetTryAppParams.mockReturnValue({ data: null })
    rerender(<TextGeneration appId="test-app-id" appData={createMockAppData()} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'sends the current inputs to the result and shows a dismissible completion notice (workflow: %s)',
    async (isWorkflow) => {
      const user = userEvent.setup()
      const appData = createMockAppData()
      render(<TextGeneration appId="test-app-id" appData={appData} isWorkflow={isWorkflow} />)
      expect(screen.getByTestId('result-component')).toHaveAttribute(
        'data-is-workflow',
        String(isWorkflow),
      )
      expect(screen.getByTestId('result-component')).toHaveAttribute('data-app-id', 'test-app-id')
      expect(screen.getByRole('status', { name: 'Generation requested' })).toHaveTextContent(
        'false',
      )
      expect(screen.queryByText('explore.tryApp.tryInfo')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Change Inputs' }))
      await user.click(screen.getByRole('button', { name: 'Send' }))
      expect(screen.getByRole('status', { name: 'Generation requested' })).toHaveTextContent('true')
      expect(screen.getByRole('status', { name: 'Submitted inputs' })).toHaveTextContent(
        '{"testInput":"testValue"}',
      )
      expect(mockUpdateAppInfo).toHaveBeenCalledWith(appData)
      expect(mockUpdateAppParams).toHaveBeenCalledWith(mockAppParams)

      await user.click(screen.getByRole('button', { name: 'Complete' }))
      expect(screen.getByText('explore.tryApp.tryInfo')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() =>
        expect(screen.queryByText('explore.tryApp.tryInfo')).not.toBeInTheDocument(),
      )
    },
  )
})
