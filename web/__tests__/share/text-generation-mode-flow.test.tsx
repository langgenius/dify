import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TextGeneration from '@/app/components/share/text-generation'

const useSearchParamsMock = vi.fn(() => new URLSearchParams())
const mockUseTextGenerationAppState = vi.fn()
const mockUseTextGenerationBatch = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => useSearchParamsMock(),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'pc',
  MediaType: { pc: 'pc', pad: 'pad', mobile: 'mobile' },
}))

vi.mock('@/app/components/share/text-generation/hooks/use-text-generation-app-state', () => ({
  useTextGenerationAppState: (...args: unknown[]) => mockUseTextGenerationAppState(...args),
}))

vi.mock('@/app/components/share/text-generation/hooks/use-text-generation-batch', () => ({
  useTextGenerationBatch: (...args: unknown[]) => mockUseTextGenerationBatch(...args),
}))

vi.mock('@/app/components/share/text-generation/text-generation-sidebar', () => ({
  default: ({
    currentTab,
    onTabChange,
  }: {
    currentTab: string
    onTabChange: (tab: string) => void
  }) => (
    <div data-testid="text-generation-sidebar">
      <span data-testid="current-tab">{currentTab}</span>
      <button type="button" onClick={() => onTabChange('batch')}>switch-to-batch</button>
      <button type="button" onClick={() => onTabChange('create')}>switch-to-create</button>
    </div>
  ),
}))

vi.mock('@/app/components/share/text-generation/text-generation-result-panel', () => ({
  default: ({
    isCallBatchAPI,
    resultExisted,
  }: {
    isCallBatchAPI: boolean
    resultExisted: boolean
  }) => (
    <div
      data-testid="text-generation-result-panel"
      data-batch={String(isCallBatchAPI)}
      data-result={String(resultExisted)}
    />
  ),
}))

const createReadyAppState = () => ({
  accessMode: 'public',
  appId: 'app-123',
  appSourceType: 'published',
  customConfig: {
    remove_webapp_brand: false,
    replace_webapp_logo: '',
  },
  handleRemoveSavedMessage: vi.fn(),
  handleSaveMessage: vi.fn(),
  moreLikeThisConfig: {
    enabled: true,
  },
  promptConfig: {
    user_input_form: [],
  },
  savedMessages: [],
  siteInfo: {
    title: 'Text Generation',
  },
  systemFeatures: {
    branding: {
      enabled: false,
      workspace_logo: null,
    },
  },
  textToSpeechConfig: {
    enabled: true,
  },
  visionConfig: null,
})

const createBatchState = () => ({
  allFailedTaskList: [],
  allSuccessTaskList: [],
  allTaskList: [],
  allTasksRun: false,
  controlRetry: 0,
  exportRes: vi.fn(),
  handleCompleted: vi.fn(),
  handleRetryAllFailedTask: vi.fn(),
  handleRunBatch: vi.fn(),
  isCallBatchAPI: false,
  noPendingTask: true,
  resetBatchExecution: vi.fn(),
  setIsCallBatchAPI: vi.fn(),
  showTaskList: false,
})

describe('Text Generation Mode Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSearchParamsMock.mockReturnValue(new URLSearchParams())
    mockUseTextGenerationAppState.mockReturnValue(createReadyAppState())
    mockUseTextGenerationBatch.mockReturnValue(createBatchState())
  })

  it('shows the loading state before app metadata is ready', () => {
    mockUseTextGenerationAppState.mockReturnValue({
      ...createReadyAppState(),
      appId: '',
      promptConfig: null,
      siteInfo: null,
    })

    render(<TextGeneration />)

    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  })

  it('hydrates the initial tab from the mode query parameter and lets the sidebar switch it', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('mode=batch'))

    render(<TextGeneration />)

    expect(screen.getByTestId('current-tab')).toHaveTextContent('batch')

    fireEvent.click(screen.getByRole('button', { name: 'switch-to-create' }))

    expect(screen.getByTestId('current-tab')).toHaveTextContent('create')
  })

  it('falls back to create mode for unsupported query values', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('mode=unsupported'))

    render(<TextGeneration />)

    expect(screen.getByTestId('current-tab')).toHaveTextContent('create')
    expect(screen.getByTestId('text-generation-result-panel')).toHaveAttribute('data-batch', 'false')
  })
})
