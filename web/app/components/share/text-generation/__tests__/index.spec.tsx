import type { TextGenerationRunControl } from '../types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import TextGeneration from '../index'

const {
  mockMode,
  mockMedia,
  mockAppStateRef,
  mockBatchStateRef,
  sidebarPropsSpy,
  resultPanelPropsSpy,
  mockSetIsCallBatchAPI,
  mockResetBatchExecution,
  mockHandleRunBatch,
} = vi.hoisted(() => ({
  mockMode: { value: 'create' },
  mockMedia: { value: 'pc' },
  mockAppStateRef: { value: null as unknown },
  mockBatchStateRef: { value: null as unknown },
  sidebarPropsSpy: vi.fn(),
  resultPanelPropsSpy: vi.fn(),
  mockSetIsCallBatchAPI: vi.fn(),
  mockResetBatchExecution: vi.fn(),
  mockHandleRunBatch: vi.fn(),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
    tablet: 'tablet',
  },
  default: () => mockMedia.value,
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => key === 'mode' ? mockMode.value : null,
  }),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: ({ type }: { type: string }) => <div data-testid="loading-app">{type}</div>,
}))

vi.mock('../hooks/use-text-generation-app-state', () => ({
  useTextGenerationAppState: () => mockAppStateRef.value,
}))

vi.mock('../hooks/use-text-generation-batch', () => ({
  useTextGenerationBatch: () => mockBatchStateRef.value,
}))

vi.mock('../text-generation-sidebar', () => ({
  default: (props: {
    currentTab: string
    onRunOnceSend: () => void
    onBatchSend: (data: string[][]) => void
  }) => {
    sidebarPropsSpy(props)
    return (
      <div data-testid="sidebar">
        <span data-testid="sidebar-current-tab">{props.currentTab}</span>
        <button type="button" onClick={props.onRunOnceSend}>run-once</button>
        <button type="button" onClick={() => props.onBatchSend([['name'], ['Alice']])}>run-batch</button>
      </div>
    )
  },
}))

vi.mock('../text-generation-result-panel', () => ({
  default: (props: {
    allTaskList: unknown[]
    controlSend: number
    controlStopResponding: number
    isShowResultPanel: boolean
    onRunControlChange: (value: TextGenerationRunControl | null) => void
    onRunStart: () => void
  }) => {
    resultPanelPropsSpy(props)
    return (
      <div data-testid="result-panel">
        <span data-testid="show-result">{props.isShowResultPanel ? 'shown' : 'hidden'}</span>
        <span data-testid="control-send">{String(props.controlSend)}</span>
        <span data-testid="control-stop">{String(props.controlStopResponding)}</span>
        <span data-testid="task-count">{String(props.allTaskList.length)}</span>
        <button
          type="button"
          onClick={() => props.onRunControlChange({ isStopping: false, onStop: vi.fn() })}
        >
          set-run-control
        </button>
        <button type="button" onClick={props.onRunStart}>start-run</button>
      </div>
    )
  },
}))

const createAppState = (overrides: Record<string, unknown> = {}) => ({
  accessMode: AccessMode.PUBLIC,
  appId: 'app-1',
  appSourceType: 'webApp',
  customConfig: {
    remove_webapp_brand: false,
    replace_webapp_logo: '',
  },
  handleRemoveSavedMessage: vi.fn(),
  handleSaveMessage: vi.fn(),
  moreLikeThisConfig: { enabled: true },
  promptConfig: {
    prompt_template: '',
    prompt_variables: [{ key: 'name', name: 'Name', type: 'string', required: true }],
  },
  savedMessages: [],
  siteInfo: {
    title: 'Generator',
    description: 'Description',
  },
  systemFeatures: {},
  textToSpeechConfig: { enabled: true },
  visionConfig: { enabled: false },
  ...overrides,
})

const createBatchState = (overrides: Record<string, unknown> = {}) => ({
  allFailedTaskList: [],
  allSuccessTaskList: [],
  allTaskList: [],
  allTasksRun: true,
  controlRetry: 0,
  exportRes: [],
  handleCompleted: vi.fn(),
  handleRetryAllFailedTask: vi.fn(),
  handleRunBatch: (data: string[][], options: { onStart: () => void }) => {
    mockHandleRunBatch(data, options)
    options.onStart()
    return true
  },
  isCallBatchAPI: false,
  noPendingTask: true,
  resetBatchExecution: () => mockResetBatchExecution(),
  setIsCallBatchAPI: (value: boolean) => mockSetIsCallBatchAPI(value),
  showTaskList: [],
  ...overrides,
})

describe('TextGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockMode.value = 'create'
    mockMedia.value = 'pc'
    mockAppStateRef.value = createAppState()
    mockBatchStateRef.value = createBatchState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render the loading state until app state is ready', () => {
    mockAppStateRef.value = createAppState({ appId: '', siteInfo: null, promptConfig: null })

    render(<TextGeneration />)

    expect(screen.getByTestId('loading-app')).toHaveTextContent('app')
  })

  it('should fall back to create mode for unsupported query params and keep installed-app layout classes', () => {
    mockMode.value = 'unsupported'

    const { container } = render(<TextGeneration isInstalledApp />)

    expect(screen.getByTestId('sidebar-current-tab')).toHaveTextContent('create')
    expect(sidebarPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      currentTab: 'create',
      isInstalledApp: true,
      isPC: true,
    }))

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('flex', 'h-full', 'rounded-2xl', 'shadow-md')
  })

  it('should orchestrate a run-once request and reveal the result panel', async () => {
    render(<TextGeneration />)

    fireEvent.click(screen.getByRole('button', { name: 'run-once' }))

    act(() => {
      vi.runAllTimers()
    })

    expect(mockSetIsCallBatchAPI).toHaveBeenCalledWith(false)
    expect(mockResetBatchExecution).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('show-result')).toHaveTextContent('shown')
    expect(Number(screen.getByTestId('control-send').textContent)).toBeGreaterThan(0)
  })

  it('should orchestrate batch runs through the batch hook and expose the result panel', async () => {
    mockMode.value = 'batch'

    render(<TextGeneration />)

    fireEvent.click(screen.getByRole('button', { name: 'run-batch' }))

    act(() => {
      vi.runAllTimers()
    })

    expect(mockHandleRunBatch).toHaveBeenCalledWith(
      [['name'], ['Alice']],
      expect.objectContaining({ onStart: expect.any(Function) }),
    )
    expect(screen.getByTestId('show-result')).toHaveTextContent('shown')
    expect(Number(screen.getByTestId('control-stop').textContent)).toBeGreaterThan(0)
  })
})
