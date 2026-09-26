import type { ExportSecretEnvironmentVariable } from '@/app/components/workflow/export-secret-env-event'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import { EventEmitter } from 'ahooks/lib/useEventEmitter'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { EventEmitterContext } from '@/context/event-emitter'
import RagPipelineChildren from '../rag-pipeline-children'

let mockShowImportDSLModal = false
const EventEmitterProvider = EventEmitterContext.Provider
let eventEmitter: EventEmitter<EventEmitterValue>

const {
  mockSetShowImportDSLModal,
  mockHandlePaneContextmenuCancel,
  mockExportCheck,
  mockHandleExportDSL,
  mockUseRagPipelineSearch,
} = vi.hoisted(() => ({
  mockSetShowImportDSLModal: vi.fn((value: boolean) => {
    mockShowImportDSLModal = value
  }),
  mockHandlePaneContextmenuCancel: vi.fn(),
  mockExportCheck: vi.fn(),
  mockHandleExportDSL: vi.fn(),
  mockUseRagPipelineSearch: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: <T,>(
    selector: (state: { accessControl: { canImportExportDSL: boolean } }) => T,
  ): T =>
    selector({
      accessControl: {
        canImportExportDSL: true,
      },
    }),
}))

vi.mock('@/app/components/workflow/hooks/use-DSL', () => ({
  useDSL: () => ({
    exportCheck: mockExportCheck,
    handleExportDSL: mockHandleExportDSL,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-panel-interactions', () => ({
  usePanelInteractions: () => ({
    handlePaneContextmenuCancel: mockHandlePaneContextmenuCancel,
  }),
}))

vi.mock('../../hooks/use-rag-pipeline-search', () => ({
  useRagPipelineSearch: mockUseRagPipelineSearch,
}))

vi.mock('@/app/components/workflow/plugin-dependency', () => ({
  default: () => <div data-testid="plugin-dependency" />,
}))

vi.mock('../panel', () => ({
  default: () => <div data-testid="rag-panel" />,
}))

vi.mock('../publish-toast', () => ({
  default: () => <div data-testid="publish-toast" />,
}))

vi.mock('../rag-pipeline-header', () => ({
  default: () => <div data-testid="rag-header" />,
}))

vi.mock('../update-dsl-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="update-dsl-modal">
      <button onClick={onCancel}>close import</button>
    </div>
  ),
}))

vi.mock('../export-confirm-modal', () => ({
  default: ({
    envList,
    onConfirm,
    onClose,
  }: {
    envList: ExportSecretEnvironmentVariable[]
    onConfirm: () => void
    onClose: () => void
  }) => (
    <div data-testid="dsl-export-modal">
      <div>{envList.map((env) => env.name).join(',')}</div>
      <button onClick={onConfirm}>confirm export</button>
      <button onClick={onClose}>close export</button>
    </div>
  ),
}))

const render = (pipelineId = 'pipeline-1') => {
  const store = createWorkflowStore({})
  store.setState({
    pipelineId,
    showImportDSLModal: mockShowImportDSLModal,
    setShowImportDSLModal: mockSetShowImportDSLModal,
  })
  return {
    ...rtlRender(<RagPipelineChildren />, {
      wrapper: ({ children }) => (
        <EventEmitterProvider value={{ eventEmitter }}>
          <WorkflowContext value={store}>{children}</WorkflowContext>
        </EventEmitterProvider>
      ),
    }),
    store,
  }
}

describe('RagPipelineChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShowImportDSLModal = false
    eventEmitter = new EventEmitter<EventEmitterValue>()
  })

  it('should render the main pipeline children and the import modal when enabled', () => {
    mockShowImportDSLModal = true

    render()

    fireEvent.click(screen.getByText('close import'))

    expect(mockUseRagPipelineSearch).toHaveBeenCalled()
    expect(screen.getByTestId('plugin-dependency')).toBeInTheDocument()
    expect(screen.getByTestId('rag-header')).toBeInTheDocument()
    expect(screen.getByTestId('rag-panel')).toBeInTheDocument()
    expect(screen.getByTestId('publish-toast')).toBeInTheDocument()
    expect(screen.getByTestId('update-dsl-modal')).toBeInTheDocument()
    expect(mockSetShowImportDSLModal).toHaveBeenCalledWith(false)
  })

  it('should show the DSL export confirmation modal after receiving the export event', () => {
    const { store } = render()

    act(() => {
      eventEmitter.emit({
        type: DSL_EXPORT_CHECK,
        payload: {
          target: store,
          data: [{ name: 'API_KEY', value: 'secret' }],
        },
      })
    })

    fireEvent.click(screen.getByText('confirm export'))

    expect(screen.getByTestId('dsl-export-modal')).toHaveTextContent('API_KEY')
    expect(mockHandleExportDSL).toHaveBeenCalledTimes(1)
  })
})

describe('RagPipelineChildren session ownership', () => {
  it.each(['pipeline-1', 'pipeline-2'])(
    'ignores a previous session export event after mounting %s',
    (pipelineId) => {
      eventEmitter = new EventEmitter<EventEmitterValue>()
      const previous = render()
      previous.unmount()
      const current = render(pipelineId)
      const data = [{ name: 'OLD_API_KEY', value: 'secret' }]

      act(() =>
        eventEmitter.emit({
          type: DSL_EXPORT_CHECK,
          payload: { target: previous.store, data },
        }),
      )
      expect(screen.queryByTestId('dsl-export-modal')).not.toBeInTheDocument()

      act(() =>
        eventEmitter.emit({
          type: DSL_EXPORT_CHECK,
          payload: { target: current.store, data },
        }),
      )
      expect(screen.getByTestId('dsl-export-modal')).toHaveTextContent('OLD_API_KEY')
    },
  )
})
