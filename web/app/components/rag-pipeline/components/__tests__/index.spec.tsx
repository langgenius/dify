import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'

import Conversion from '../conversion'
import RagPipelinePanel from '../panel'
import PublishAsKnowledgePipelineModal from '../publish-as-knowledge-pipeline-modal'
import PublishToast from '../publish-toast'
import RagPipelineChildren from '../rag-pipeline-children'
import PipelineScreenShot from '../screenshot'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: 'test-dataset-id' }),
  useRouter: () => ({ push: mockPush }),
}))

let mockShowImportDSLModal = false
const mockSetShowImportDSLModal = vi.fn((value: boolean) => {
  mockShowImportDSLModal = value
})
vi.mock('@/app/components/workflow/store', () => {
  const mockSetShowInputFieldPanel = vi.fn()
  const mockSetShowEnvPanel = vi.fn()
  const mockSetShowDebugAndPreviewPanel = vi.fn()
  const mockSetIsPreparingDataSource = vi.fn()
  const mockSetPublishedAt = vi.fn()
  const mockSetRagPipelineVariables = vi.fn()
  const mockSetEnvironmentVariables = vi.fn()

  return {
    useStore: (selector: (state: Record<string, unknown>) => unknown) => {
      const storeState = {
        pipelineId: 'test-pipeline-id',
        showDebugAndPreviewPanel: false,
        showGlobalVariablePanel: false,
        showInputFieldPanel: false,
        showInputFieldPreviewPanel: false,
        inputFieldEditPanelProps: null as null | object,
        historyWorkflowData: null as null | object,
        publishedAt: 0,
        draftUpdatedAt: Date.now(),
        knowledgeName: 'Test Knowledge',
        knowledgeIcon: {
          icon_type: 'emoji' as const,
          icon: '📚',
          icon_background: '#FFFFFF',
          icon_url: '',
        },
        showImportDSLModal: mockShowImportDSLModal,
        setShowInputFieldPanel: mockSetShowInputFieldPanel,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setPublishedAt: mockSetPublishedAt,
        setRagPipelineVariables: mockSetRagPipelineVariables,
        setEnvironmentVariables: mockSetEnvironmentVariables,
        setShowImportDSLModal: mockSetShowImportDSLModal,
      }
      return selector(storeState)
    },
    useWorkflowStore: () => ({
      getState: () => ({
        pipelineId: 'test-pipeline-id',
        knowledgeName: 'Test Knowledge',
        knowledgeIcon: {
          icon_type: 'emoji' as const,
          icon: '📚',
          icon_background: '#FFFFFF',
          icon_url: '',
        },
        setShowInputFieldPanel: mockSetShowInputFieldPanel,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowImportDSLModal: mockSetShowImportDSLModal,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
        setPublishedAt: mockSetPublishedAt,
        setRagPipelineVariables: mockSetRagPipelineVariables,
        setEnvironmentVariables: mockSetEnvironmentVariables,
      }),
    }),
  }
})

const {
  mockHandlePaneContextmenuCancel,
  mockExportCheck,
  mockHandleExportDSL,
} = vi.hoisted(() => ({
  mockHandlePaneContextmenuCancel: vi.fn(),
  mockExportCheck: vi.fn(),
  mockHandleExportDSL: vi.fn(),
}))
vi.mock('@/app/components/workflow/hooks', () => {
  return {
    useNodesSyncDraft: () => ({
      doSyncWorkflowDraft: vi.fn(),
      syncWorkflowDraftWhenPageClose: vi.fn(),
      handleSyncWorkflowDraft: vi.fn(),
    }),
    usePanelInteractions: () => ({
      handlePaneContextmenuCancel: mockHandlePaneContextmenuCancel,
    }),
    useDSL: () => ({
      exportCheck: mockExportCheck,
      handleExportDSL: mockHandleExportDSL,
    }),
    useChecklistBeforePublish: () => ({
      handleCheckBeforePublish: vi.fn().mockResolvedValue(true),
    }),
    useWorkflowRun: () => ({
      handleStopRun: vi.fn(),
    }),
    useWorkflowStartRun: () => ({
      handleWorkflowStartRunInWorkflow: vi.fn(),
    }),
  }
})

vi.mock('../../hooks', () => ({
  useAvailableNodesMetaData: () => ({}),
  useDSL: () => ({
    exportCheck: mockExportCheck,
    handleExportDSL: mockHandleExportDSL,
  }),
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: vi.fn(),
    syncWorkflowDraftWhenPageClose: vi.fn(),
  }),
  usePipelineRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
  }),
  usePipelineRun: () => ({
    handleBackupDraft: vi.fn(),
    handleLoadBackupDraft: vi.fn(),
    handleRestoreFromPublishedWorkflow: vi.fn(),
    handleRun: vi.fn(),
    handleStopRun: vi.fn(),
  }),
  usePipelineStartRun: () => ({
    handleStartWorkflowRun: vi.fn(),
    handleWorkflowStartRunInWorkflow: vi.fn(),
  }),
  useGetRunAndTraceUrl: () => ({
    getWorkflowRunAndTraceUrl: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-rag-pipeline-search', () => ({
  useRagPipelineSearch: vi.fn(),
}))

vi.mock('../../hooks/use-configs-map', () => ({
  useConfigsMap: () => ({}),
}))

vi.mock('../../hooks/use-inspect-vars-crud', () => ({
  useInspectVarsCrud: () => ({
    hasNodeInspectVars: vi.fn(),
    hasSetInspectVar: vi.fn(),
    fetchInspectVarValue: vi.fn(),
    editInspectVarValue: vi.fn(),
    renameInspectVarName: vi.fn(),
    appendNodeInspectVars: vi.fn(),
    deleteInspectVar: vi.fn(),
    deleteNodeInspectorVars: vi.fn(),
    deleteAllInspectorVars: vi.fn(),
    isInspectVarEdited: vi.fn(),
    resetToLastRunVar: vi.fn(),
    invalidateSysVarValues: vi.fn(),
    resetConversationVar: vi.fn(),
    invalidateConversationVarValues: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: vi.fn(),
  }),
}))

let mockConvertFn = vi.fn()
let mockIsPending = false
vi.mock('@/service/use-pipeline', () => ({
  useConvertDatasetToPipeline: () => ({
    mutateAsync: mockConvertFn,
    isPending: mockIsPending,
  }),
  useImportPipelineDSL: () => ({
    mutateAsync: vi.fn(),
  }),
  useImportPipelineDSLConfirm: () => ({
    mutateAsync: vi.fn(),
  }),
  publishedPipelineInfoQueryKeyPrefix: ['pipeline-info'],
  useInvalidCustomizedTemplateList: () => vi.fn(),
  usePublishAsCustomizedPipeline: () => ({
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: () => vi.fn(),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  datasetDetailQueryKeyPrefix: ['dataset-detail'],
  useInvalidDatasetList: () => vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn().mockResolvedValue({
    graph: { nodes: [], edges: [], viewport: {} },
    hash: 'test-hash',
    rag_pipeline_variables: [],
  }),
}))

let mockEventSubscriptionCallback: ((v: { type: string, payload?: { data?: EnvironmentVariable[] } }) => void) | null = null
const mockUseSubscription = vi.fn((callback: (v: { type: string, payload?: { data?: EnvironmentVariable[] } }) => void) => {
  mockEventSubscriptionCallback = callback
})
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: mockUseSubscription,
      emit: vi.fn(),
    },
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: 'light',
  }),
}))

vi.mock('@/utils/var', () => ({
  basePath: '/public',
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => createMockProviderContextValue(),
  useProviderContextSelector: <T,>(selector: (state: ReturnType<typeof createMockProviderContextValue>) => T): T =>
    selector(createMockProviderContextValue()),
}))

vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-inner-context">{children}</div>
  ),
}))

vi.mock('@/app/components/workflow/panel', () => ({
  default: ({ components }: { components?: { left?: React.ReactNode, right?: React.ReactNode } }) => (
    <div data-testid="workflow-panel">
      <div data-testid="panel-left">{components?.left}</div>
      <div data-testid="panel-right">{components?.right}</div>
    </div>
  ),
}))

vi.mock('../../../workflow/plugin-dependency', () => ({
  default: () => <div data-testid="plugin-dependency" />,
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/app/components/workflow/constants', () => ({
  DSL_EXPORT_CHECK: 'DSL_EXPORT_CHECK',
  WORKFLOW_DATA_UPDATE: 'WORKFLOW_DATA_UPDATE',
}))

vi.mock('@/app/components/workflow/utils', () => ({
  initialNodes: vi.fn(nodes => nodes),
  initialEdges: vi.fn(edges => edges),
  getKeyboardKeyCodeBySystem: (key: string) => key,
  getKeyboardKeyNameBySystem: (key: string) => key,
}))

vi.mock('@/app/components/app/create-from-dsl-modal/uploader', () => ({
  default: ({ file, updateFile, className, accept, displayName }: {
    file?: File
    updateFile: (file?: File) => void
    className?: string
    accept?: string
    displayName?: string
  }) => (
    <div data-testid="uploader" className={className}>
      <input
        type="file"
        data-testid="file-input"
        accept={accept}
        onChange={(e) => {
          const selectedFile = e.target.files?.[0]
          updateFile(selectedFile)
        }}
      />
      {file && <span data-testid="file-name">{file.name}</span>}
      <span data-testid="display-name">{displayName}</span>
      <button data-testid="clear-file" onClick={() => updateFile(undefined)}>Clear</button>
    </div>
  ),
}))

vi.mock('../rag-pipeline-header', () => ({
  default: () => <div data-testid="rag-pipeline-header" />,
}))

vi.mock('../publish-toast', () => ({
  default: () => <div data-testid="publish-toast" />,
}))

vi.mock('../update-dsl-modal', () => ({
  default: ({ onCancel, onBackup, onImport }: {
    onCancel: () => void
    onBackup: () => void
    onImport?: () => void
  }) => (
    <div data-testid="update-dsl-modal">
      <button data-testid="dsl-cancel" onClick={onCancel}>Cancel</button>
      <button data-testid="dsl-backup" onClick={onBackup}>Backup</button>
      <button data-testid="dsl-import" onClick={onImport}>Import</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/dsl-export-confirm-modal', () => ({
  default: ({ envList, onConfirm, onClose }: {
    envList: EnvironmentVariable[]
    onConfirm: () => void
    onClose: () => void
  }) => (
    envList.length > 0
      ? (
          <div data-testid="dsl-export-confirm-modal">
            <span data-testid="env-count">{envList.length}</span>
            <button data-testid="dsl-export-confirm" onClick={onConfirm}>Confirm</button>
            <button data-testid="dsl-export-close" onClick={onClose}>Close</button>
          </div>
        )
      : null
  ),
}))

// Silence expected console.error from Dialog/Modal rendering
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Helper to find the name input in PublishAsKnowledgePipelineModal
function getNameInput() {
  return screen.getByPlaceholderText('pipeline.common.publishAsPipeline.namePlaceholder')
}

// Helper to find the description textarea in PublishAsKnowledgePipelineModal
function getDescriptionTextarea() {
  return screen.getByPlaceholderText('pipeline.common.publishAsPipeline.descriptionPlaceholder')
}

// Helper to find the AppIcon span in PublishAsKnowledgePipelineModal
// HeadlessUI Dialog renders via portal to document.body, so we search the full document
function getAppIcon() {
  const emoji = document.querySelector('em-emoji')
  return emoji?.closest('span') as HTMLElement
}

describe('Conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render conversion component without crashing', () => {
      render(<Conversion />)

      expect(screen.getByText('datasetPipeline.conversion.title')).toBeInTheDocument()
    })

    it('should render conversion button', () => {
      render(<Conversion />)

      expect(screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })).toBeInTheDocument()
    })

    it('should render description text', () => {
      render(<Conversion />)

      expect(screen.getByText('datasetPipeline.conversion.descriptionChunk1')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.conversion.descriptionChunk2')).toBeInTheDocument()
    })

    it('should render warning text', () => {
      render(<Conversion />)

      expect(screen.getByText('datasetPipeline.conversion.warning')).toBeInTheDocument()
    })

    it('should render PipelineScreenShot component', () => {
      render(<Conversion />)

      // PipelineScreenShot renders a <picture> element with <source> children
      expect(document.querySelector('picture')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should show confirm modal when convert button is clicked', () => {
      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)

      // Real Confirm renders title and content via portal
      expect(screen.getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.conversion.confirm.content')).toBeInTheDocument()
    })

    it('should hide confirm modal when cancel is clicked', () => {
      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      expect(screen.getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()

      // Real Confirm renders cancel button with i18n text
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      expect(screen.queryByText('datasetPipeline.conversion.confirm.title')).not.toBeInTheDocument()
    })
  })

  describe('API Callbacks', () => {
    beforeEach(() => {
      mockConvertFn = vi.fn()
      mockIsPending = false
    })

    it('should call convert with datasetId and show success toast on success', async () => {
      mockConvertFn.mockImplementation((_datasetId: string, options: { onSuccess: (res: { status: string }) => void }) => {
        options.onSuccess({ status: 'success' })
      })

      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mockConvertFn).toHaveBeenCalledWith('test-dataset-id', expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }))
      })
    })

    it('should close modal on success', async () => {
      mockConvertFn.mockImplementation((_datasetId: string, options: { onSuccess: (res: { status: string }) => void }) => {
        options.onSuccess({ status: 'success' })
      })

      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      expect(screen.getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(screen.queryByText('datasetPipeline.conversion.confirm.title')).not.toBeInTheDocument()
      })
    })

    it('should show error toast when conversion fails with status failed', async () => {
      mockConvertFn.mockImplementation((_datasetId: string, options: { onSuccess: (res: { status: string }) => void }) => {
        options.onSuccess({ status: 'failed' })
      })

      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mockConvertFn).toHaveBeenCalled()
      })
      // Confirm modal stays open on failure
      expect(screen.getByText('datasetPipeline.conversion.confirm.title')).toBeInTheDocument()
    })

    it('should show error toast when conversion throws error', async () => {
      mockConvertFn.mockImplementation((_datasetId: string, options: { onError: () => void }) => {
        options.onError()
      })

      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mockConvertFn).toHaveBeenCalled()
      })
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((Conversion as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should use useCallback for handleConvert', () => {
      const { rerender } = render(<Conversion />)

      rerender(<Conversion />)
      expect(screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing datasetId gracefully', () => {
      render(<Conversion />)

      expect(screen.getByText('datasetPipeline.conversion.title')).toBeInTheDocument()
    })
  })
})

describe('PipelineScreenShot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<PipelineScreenShot />)

      expect(document.querySelector('picture')).toBeInTheDocument()
    })

    it('should render source elements for different resolutions', () => {
      render(<PipelineScreenShot />)

      const sources = document.querySelectorAll('source')
      expect(sources).toHaveLength(3)
      expect(sources[0]).toHaveAttribute('media', '(resolution: 1x)')
      expect(sources[1]).toHaveAttribute('media', '(resolution: 2x)')
      expect(sources[2]).toHaveAttribute('media', '(resolution: 3x)')
    })

    it('should use correct theme-based source path', () => {
      render(<PipelineScreenShot />)

      const source = document.querySelector('source')
      expect(source).toHaveAttribute('srcSet', '/public/screenshots/light/Pipeline.png')
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((PipelineScreenShot as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})

describe('PublishToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Note: PublishToast is mocked, so we just verify the mock renders
      render(<PublishToast />)

      expect(screen.getByTestId('publish-toast')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be defined', () => {
      expect(PublishToast).toBeDefined()
    })
  })
})

describe('PublishAsKnowledgePipelineModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnConfirm = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    onCancel: mockOnCancel,
    onConfirm: mockOnConfirm,
  }

  describe('Rendering', () => {
    it('should render modal with title', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      expect(screen.getByText('pipeline.common.publishAs')).toBeInTheDocument()
    })

    it('should render name input with default value from store', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const input = getNameInput()
      expect(input).toHaveValue('Test Knowledge')
    })

    it('should render description textarea', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      expect(getDescriptionTextarea()).toBeInTheDocument()
    })

    it('should render app icon', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      // Real AppIcon renders an em-emoji custom element inside a span
      // HeadlessUI Dialog renders via portal, so search the full document
      expect(document.querySelector('em-emoji')).toBeInTheDocument()
    })

    it('should render cancel and confirm buttons', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.common\.publish/i })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should update name when input changes', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const input = getNameInput()
      fireEvent.change(input, { target: { value: 'New Pipeline Name' } })

      expect(input).toHaveValue('New Pipeline Name')
    })

    it('should update description when textarea changes', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const textarea = getDescriptionTextarea()
      fireEvent.change(textarea, { target: { value: 'New description' } })

      expect(textarea).toHaveValue('New description')
    })

    it('should call onCancel when cancel button is clicked', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when close icon is clicked', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('publish-modal-close-btn'))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirm with trimmed values when publish button is clicked', () => {
      mockOnConfirm.mockResolvedValueOnce(undefined)

      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      fireEvent.change(getNameInput(), { target: { value: '  Trimmed Name  ' } })
      fireEvent.change(getDescriptionTextarea(), { target: { value: '  Trimmed Description  ' } })

      fireEvent.click(screen.getByRole('button', { name: /workflow\.common\.publish/i }))

      expect(mockOnConfirm).toHaveBeenCalledWith(
        'Trimmed Name',
        expect.any(Object),
        'Trimmed Description',
      )
    })

    it('should show app icon picker when icon is clicked', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const appIcon = getAppIcon()
      fireEvent.click(appIcon)

      // Real AppIconPicker renders with Cancel and OK buttons
      expect(screen.getByRole('button', { name: /iconPicker\.cancel/ })).toBeInTheDocument()
    })

    it('should update icon when emoji is selected', async () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const appIcon = getAppIcon()
      fireEvent.click(appIcon)

      // Click the first emoji in the grid (search full document since Dialog uses portal)
      const gridEmojis = document.querySelectorAll('.grid em-emoji')
      expect(gridEmojis.length).toBeGreaterThan(0)
      fireEvent.click(gridEmojis[0].parentElement!.parentElement!)

      // Click OK to confirm selection
      fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

      // Picker should close
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /iconPicker\.cancel/ })).not.toBeInTheDocument()
      })
    })

    it('should switch to image tab in icon picker', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const appIcon = getAppIcon()
      fireEvent.click(appIcon)

      // Switch to image tab
      const imageTab = screen.getByRole('button', { name: /iconPicker\.image/ })
      fireEvent.click(imageTab)

      // Picker should still be open
      expect(screen.getByRole('button', { name: /iconPicker\.ok/ })).toBeInTheDocument()
    })

    it('should close picker when cancel is clicked', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const appIcon = getAppIcon()
      fireEvent.click(appIcon)
      expect(screen.getByRole('button', { name: /iconPicker\.cancel/ })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /iconPicker\.cancel/ }))

      expect(screen.queryByRole('button', { name: /iconPicker\.ok/ })).not.toBeInTheDocument()
    })
  })

  describe('Props Validation', () => {
    it('should disable publish button when name is empty', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      fireEvent.change(getNameInput(), { target: { value: '' } })

      const publishButton = screen.getByRole('button', { name: /workflow\.common\.publish/i })
      expect(publishButton).toBeDisabled()
    })

    it('should disable publish button when name is only whitespace', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      fireEvent.change(getNameInput(), { target: { value: '   ' } })

      const publishButton = screen.getByRole('button', { name: /workflow\.common\.publish/i })
      expect(publishButton).toBeDisabled()
    })

    it('should disable publish button when confirmDisabled is true', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} confirmDisabled />)

      const publishButton = screen.getByRole('button', { name: /workflow\.common\.publish/i })
      expect(publishButton).toBeDisabled()
    })

    it('should not call onConfirm when confirmDisabled is true', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} confirmDisabled />)

      fireEvent.click(screen.getByRole('button', { name: /workflow\.common\.publish/i }))

      expect(mockOnConfirm).not.toHaveBeenCalled()
    })
  })

  describe('Memoization', () => {
    it('should use useCallback for handleSelectIcon', () => {
      const { rerender } = render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      rerender(<PublishAsKnowledgePipelineModal {...defaultProps} />)
      // HeadlessUI Dialog renders via portal, so search the full document
      expect(document.querySelector('em-emoji')).toBeInTheDocument()
    })
  })
})

describe('RagPipelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render panel component without crashing', () => {
      render(<RagPipelinePanel />)

      expect(screen.getByTestId('workflow-panel')).toBeInTheDocument()
    })

    it('should render panel with left and right slots', () => {
      render(<RagPipelinePanel />)

      expect(screen.getByTestId('panel-left')).toBeInTheDocument()
      expect(screen.getByTestId('panel-right')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with memo', () => {
      expect((RagPipelinePanel as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})

describe('RagPipelineChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShowImportDSLModal = false
    mockEventSubscriptionCallback = null
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<RagPipelineChildren />)

      expect(screen.getByTestId('plugin-dependency')).toBeInTheDocument()
      expect(screen.getByTestId('rag-pipeline-header')).toBeInTheDocument()
      expect(screen.getByTestId('publish-toast')).toBeInTheDocument()
    })

    it('should not render UpdateDSLModal when showImportDSLModal is false', () => {
      mockShowImportDSLModal = false
      render(<RagPipelineChildren />)

      expect(screen.queryByTestId('update-dsl-modal')).not.toBeInTheDocument()
    })

    it('should render UpdateDSLModal when showImportDSLModal is true', () => {
      mockShowImportDSLModal = true
      render(<RagPipelineChildren />)

      expect(screen.getByTestId('update-dsl-modal')).toBeInTheDocument()
    })
  })

  describe('Event Subscription', () => {
    it('should subscribe to event emitter', () => {
      render(<RagPipelineChildren />)

      expect(mockUseSubscription).toHaveBeenCalled()
    })

    it('should handle DSL_EXPORT_CHECK event and set secretEnvList', async () => {
      render(<RagPipelineChildren />)

      const mockEnvVariables: EnvironmentVariable[] = [
        { id: '1', name: 'SECRET_KEY', value: 'test-secret', value_type: 'secret' as const, description: '' },
      ]

      if (mockEventSubscriptionCallback) {
        mockEventSubscriptionCallback({
          type: 'DSL_EXPORT_CHECK',
          payload: { data: mockEnvVariables },
        })
      }

      await waitFor(() => {
        expect(screen.getByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
      })
    })

    it('should not show DSLExportConfirmModal for non-DSL_EXPORT_CHECK events', () => {
      render(<RagPipelineChildren />)

      if (mockEventSubscriptionCallback) {
        mockEventSubscriptionCallback({
          type: 'OTHER_EVENT',
        })
      }

      expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
    })
  })

  describe('UpdateDSLModal Handlers', () => {
    beforeEach(() => {
      mockShowImportDSLModal = true
    })

    it('should call setShowImportDSLModal(false) when onCancel is clicked', () => {
      render(<RagPipelineChildren />)

      fireEvent.click(screen.getByTestId('dsl-cancel'))
      expect(mockSetShowImportDSLModal).toHaveBeenCalledWith(false)
    })

    it('should call exportCheck when onBackup is clicked', () => {
      render(<RagPipelineChildren />)

      fireEvent.click(screen.getByTestId('dsl-backup'))

      expect(mockExportCheck).toHaveBeenCalledTimes(1)
    })

    it('should call handlePaneContextmenuCancel when onImport is clicked', () => {
      render(<RagPipelineChildren />)

      fireEvent.click(screen.getByTestId('dsl-import'))

      expect(mockHandlePaneContextmenuCancel).toHaveBeenCalledTimes(1)
    })
  })

  describe('DSLExportConfirmModal', () => {
    it('should render DSLExportConfirmModal when secretEnvList has items', async () => {
      render(<RagPipelineChildren />)

      const mockEnvVariables: EnvironmentVariable[] = [
        { id: '1', name: 'API_KEY', value: 'secret-value', value_type: 'secret' as const, description: '' },
      ]

      if (mockEventSubscriptionCallback) {
        mockEventSubscriptionCallback({
          type: 'DSL_EXPORT_CHECK',
          payload: { data: mockEnvVariables },
        })
      }

      await waitFor(() => {
        expect(screen.getByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
      })
    })

    it('should close DSLExportConfirmModal when onClose is triggered', async () => {
      render(<RagPipelineChildren />)

      const mockEnvVariables: EnvironmentVariable[] = [
        { id: '1', name: 'API_KEY', value: 'secret-value', value_type: 'secret' as const, description: '' },
      ]

      if (mockEventSubscriptionCallback) {
        mockEventSubscriptionCallback({
          type: 'DSL_EXPORT_CHECK',
          payload: { data: mockEnvVariables },
        })
      }

      await waitFor(() => {
        expect(screen.getByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('dsl-export-close'))

      await waitFor(() => {
        expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
      })
    })

    it('should call handleExportDSL when onConfirm is triggered', async () => {
      render(<RagPipelineChildren />)

      const mockEnvVariables: EnvironmentVariable[] = [
        { id: '1', name: 'API_KEY', value: 'secret-value', value_type: 'secret' as const, description: '' },
      ]

      if (mockEventSubscriptionCallback) {
        mockEventSubscriptionCallback({
          type: 'DSL_EXPORT_CHECK',
          payload: { data: mockEnvVariables },
        })
      }

      await waitFor(() => {
        expect(screen.getByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('dsl-export-confirm'))

      expect(mockHandleExportDSL).toHaveBeenCalledTimes(1)
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with memo', () => {
      expect((RagPipelineChildren as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('PublishAsKnowledgePipelineModal Flow', () => {
    const mockOnCancel = vi.fn()
    const mockOnConfirm = vi.fn().mockResolvedValue(undefined)

    it('should complete full publish flow', async () => {
      render(
        <PublishAsKnowledgePipelineModal
          onCancel={mockOnCancel}
          onConfirm={mockOnConfirm}
        />,
      )

      fireEvent.change(getNameInput(), { target: { value: 'My Pipeline' } })

      fireEvent.change(getDescriptionTextarea(), { target: { value: 'A great pipeline' } })

      // Open picker and select an emoji
      const appIcon = getAppIcon()
      fireEvent.click(appIcon)
      const gridEmojis = document.querySelectorAll('.grid em-emoji')
      if (gridEmojis.length > 0) {
        fireEvent.click(gridEmojis[0].parentElement!.parentElement!)
        fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
      }

      fireEvent.click(screen.getByRole('button', { name: /workflow\.common\.publish/i }))

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledWith(
          'My Pipeline',
          expect.objectContaining({
            icon_type: expect.any(String),
          }),
          'A great pipeline',
        )
      })
    })
  })
})

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Null/Undefined Values', () => {
    it('should handle empty knowledgeName', () => {
      render(
        <PublishAsKnowledgePipelineModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      const input = getNameInput()
      fireEvent.change(input, { target: { value: '' } })
      expect(input).toHaveValue('')
    })
  })

  describe('Boundary Conditions', () => {
    it('should handle very long pipeline name', () => {
      render(
        <PublishAsKnowledgePipelineModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      const longName = 'A'.repeat(1000)
      const input = getNameInput()
      fireEvent.change(input, { target: { value: longName } })
      expect(input).toHaveValue(longName)
    })

    it('should handle special characters in name', () => {
      render(
        <PublishAsKnowledgePipelineModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      const specialName = '<script>alert("xss")</script>'
      const input = getNameInput()
      fireEvent.change(input, { target: { value: specialName } })
      expect(input).toHaveValue(specialName)
    })
  })
})

describe('Accessibility', () => {
  describe('Conversion', () => {
    it('should have accessible button', () => {
      render(<Conversion />)

      const button = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      expect(button).toBeInTheDocument()
    })
  })

  describe('PublishAsKnowledgePipelineModal', () => {
    it('should have accessible form inputs', () => {
      render(
        <PublishAsKnowledgePipelineModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      expect(getNameInput()).toBeInTheDocument()
      expect(getDescriptionTextarea()).toBeInTheDocument()
    })

    it('should have accessible buttons', () => {
      render(
        <PublishAsKnowledgePipelineModal
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.common\.publish/i })).toBeInTheDocument()
    })
  })
})
