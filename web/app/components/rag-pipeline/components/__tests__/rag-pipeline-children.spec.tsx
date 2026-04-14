import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import RagPipelineChildren from '../rag-pipeline-children'

let mockShowImportDSLModal = false
let mockSubscription: ((value: { type: string, payload?: { data?: EnvironmentVariable[] } }) => void) | null = null

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

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: (callback: (value: { type: string, payload?: { data?: EnvironmentVariable[] } }) => void) => {
        mockSubscription = callback
      },
    },
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: {
    showImportDSLModal: boolean
    setShowImportDSLModal: typeof mockSetShowImportDSLModal
  }) => unknown) => selector({
    showImportDSLModal: mockShowImportDSLModal,
    setShowImportDSLModal: mockSetShowImportDSLModal,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useDSL: () => ({
    exportCheck: mockExportCheck,
    handleExportDSL: mockHandleExportDSL,
  }),
  usePanelInteractions: () => ({
    handlePaneContextmenuCancel: mockHandlePaneContextmenuCancel,
  }),
}))

vi.mock('../../hooks/use-rag-pipeline-search', () => ({
  useRagPipelineSearch: mockUseRagPipelineSearch,
}))

vi.mock('../../../workflow/plugin-dependency', () => ({
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

vi.mock('@/app/components/workflow/dsl-export-confirm-modal', () => ({
  default: ({
    envList,
    onConfirm,
    onClose,
  }: {
    envList: EnvironmentVariable[]
    onConfirm: () => void
    onClose: () => void
  }) => (
    <div data-testid="dsl-export-modal">
      <div>{envList.map(env => env.name).join(',')}</div>
      <button onClick={onConfirm}>confirm export</button>
      <button onClick={onClose}>close export</button>
    </div>
  ),
}))

describe('RagPipelineChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShowImportDSLModal = false
    mockSubscription = null
  })

  it('should render the main pipeline children and the import modal when enabled', () => {
    mockShowImportDSLModal = true

    render(<RagPipelineChildren />)

    fireEvent.click(screen.getByText('close import'))

    expect(mockUseRagPipelineSearch).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('plugin-dependency')).toBeInTheDocument()
    expect(screen.getByTestId('rag-header')).toBeInTheDocument()
    expect(screen.getByTestId('rag-panel')).toBeInTheDocument()
    expect(screen.getByTestId('publish-toast')).toBeInTheDocument()
    expect(screen.getByTestId('update-dsl-modal')).toBeInTheDocument()
    expect(mockSetShowImportDSLModal).toHaveBeenCalledWith(false)
  })

  it('should show the DSL export confirmation modal after receiving the export event', () => {
    render(<RagPipelineChildren />)

    act(() => {
      mockSubscription?.({
        type: DSL_EXPORT_CHECK,
        payload: {
          data: [{ name: 'API_KEY' } as EnvironmentVariable],
        },
      })
    })

    fireEvent.click(screen.getByText('confirm export'))

    expect(screen.getByTestId('dsl-export-modal')).toHaveTextContent('API_KEY')
    expect(mockHandleExportDSL).toHaveBeenCalledTimes(1)
  })
})
