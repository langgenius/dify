import type { ExportSecretEnvironmentVariable as EnvironmentVariable } from '@/app/components/workflow/export-secret-env-event'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import RagPipelineChildren from '../rag-pipeline-children'

let mockShowImportDSLModal = false
let mockSubscription:
  | ((value: { type: string; payload?: { data?: EnvironmentVariable[] } }) => void)
  | null = null

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
      useSubscription: (
        callback: (value: { type: string; payload?: { data?: EnvironmentVariable[] } }) => void,
      ) => {
        mockSubscription = callback
      },
    },
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (
    selector: (state: {
      showImportDSLModal: boolean
      setShowImportDSLModal: typeof mockSetShowImportDSLModal
    }) => unknown,
  ) =>
    selector({
      showImportDSLModal: mockShowImportDSLModal,
      setShowImportDSLModal: mockSetShowImportDSLModal,
    }),
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

describe('RagPipelineChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShowImportDSLModal = false
    mockSubscription = null
    mockHandleExportDSL.mockResolvedValue(true)
  })

  it('should render the main pipeline children and the import modal when enabled', async () => {
    mockShowImportDSLModal = true

    render(<RagPipelineChildren />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'close import' }))

    expect(screen.getByTestId('update-dsl-modal')).toBeInTheDocument()
    expect(mockSetShowImportDSLModal).toHaveBeenCalledWith(false)
  })

  it('should show the DSL export confirmation modal after receiving the export event', async () => {
    const user = userEvent.setup()
    render(<RagPipelineChildren />)

    act(() => {
      mockSubscription?.({
        type: DSL_EXPORT_CHECK,
        payload: {
          data: [{ name: 'API_KEY', value: 'masked' }],
        },
      })
    })

    expect(screen.getByRole('alertdialog')).toHaveTextContent('API_KEY')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'workflow.env.export.export' }))
    expect(mockHandleExportDSL).toHaveBeenCalledExactlyOnceWith(true)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})
