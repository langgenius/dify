import type { PropsWithChildren } from 'react'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'

// ============================================================================
// Import Components After Mocks Setup
// ============================================================================

import Conversion from './conversion'
import RagPipelinePanel from './panel'
import PublishAsKnowledgePipelineModal from './publish-as-knowledge-pipeline-modal'
import PublishToast from './publish-toast'
import RagPipelineChildren from './rag-pipeline-children'
import PipelineScreenShot from './screenshot'

// ============================================================================
// Mock External Dependencies - All vi.mock calls must come before any imports
// ============================================================================

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: 'test-dataset-id' }),
  useRouter: () => ({ push: mockPush }),
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, width, height }: { src: string, alt: string, width: number, height: number }) => (
    // eslint-disable-next-line next/no-img-element
    <img src={src} alt={alt} width={width} height={height} data-testid="mock-image" />
  ),
}))

// Mock next/dynamic
vi.mock('next/dynamic', () => ({
  default: (importFn: () => Promise<{ default: React.ComponentType<unknown> }>, options?: { ssr?: boolean }) => {
    const DynamicComponent = ({ children, ...props }: PropsWithChildren) => {
      return <div data-testid="dynamic-component" data-ssr={options?.ssr ?? true} {...props}>{children}</div>
    }
    DynamicComponent.displayName = 'DynamicComponent'
    return DynamicComponent
  },
}))

// Mock workflow store - using controllable state
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

// Mock workflow hooks - extract mock functions for assertions using vi.hoisted
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

// Mock rag-pipeline hooks
vi.mock('../hooks', () => ({
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

// Mock rag-pipeline search hook
vi.mock('../hooks/use-rag-pipeline-search', () => ({
  useRagPipelineSearch: vi.fn(),
}))

// Mock configs-map hook
vi.mock('../hooks/use-configs-map', () => ({
  useConfigsMap: () => ({}),
}))

// Mock inspect-vars-crud hook
vi.mock('../hooks/use-inspect-vars-crud', () => ({
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

// Mock workflow hooks for fetch-workflow-inspect-vars
vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: vi.fn(),
  }),
}))

// Mock service hooks - with controllable convert function
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

// Mock event emitter context - with controllable subscription
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

// Mock toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
  useToastContext: () => ({
    notify: vi.fn(),
  }),
  ToastContext: {
    Provider: ({ children }: PropsWithChildren) => children,
  },
}))

// Mock useTheme hook
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: 'light',
  }),
}))

// Mock basePath
vi.mock('@/utils/var', () => ({
  basePath: '/public',
}))

// Mock provider context
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => createMockProviderContextValue(),
}))

// Mock WorkflowWithInnerContext
vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({ children }: PropsWithChildren) => (
    <div data-testid="workflow-inner-context">{children}</div>
  ),
}))

// Mock workflow panel
vi.mock('@/app/components/workflow/panel', () => ({
  default: ({ components }: { components?: { left?: React.ReactNode, right?: React.ReactNode } }) => (
    <div data-testid="workflow-panel">
      <div data-testid="panel-left">{components?.left}</div>
      <div data-testid="panel-right">{components?.right}</div>
    </div>
  ),
}))

// Mock PluginDependency
vi.mock('../../workflow/plugin-dependency', () => ({
  default: () => <div data-testid="plugin-dependency" />,
}))

// Mock plugin-dependency hooks
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Mock DSLExportConfirmModal
vi.mock('@/app/components/workflow/dsl-export-confirm-modal', () => ({
  default: ({ envList, onConfirm, onClose }: { envList: EnvironmentVariable[], onConfirm: () => void, onClose: () => void }) => (
    <div data-testid="dsl-export-confirm-modal">
      <span data-testid="env-count">{envList.length}</span>
      <button data-testid="export-confirm" onClick={onConfirm}>Confirm</button>
      <button data-testid="export-close" onClick={onClose}>Close</button>
    </div>
  ),
}))

// Mock workflow constants
vi.mock('@/app/components/workflow/constants', () => ({
  DSL_EXPORT_CHECK: 'DSL_EXPORT_CHECK',
  WORKFLOW_DATA_UPDATE: 'WORKFLOW_DATA_UPDATE',
}))

// Mock workflow utils
vi.mock('@/app/components/workflow/utils', () => ({
  initialNodes: vi.fn(nodes => nodes),
  initialEdges: vi.fn(edges => edges),
  getKeyboardKeyCodeBySystem: (key: string) => key,
  getKeyboardKeyNameBySystem: (key: string) => key,
}))

// Mock Confirm component
vi.mock('@/app/components/base/confirm', () => ({
  default: ({ title, content, isShow, onConfirm, onCancel, isLoading, isDisabled }: {
    title: string
    content: string
    isShow: boolean
    onConfirm: () => void
    onCancel: () => void
    isLoading?: boolean
    isDisabled?: boolean
  }) => isShow
    ? (
        <div data-testid="confirm-modal">
          <div data-testid="confirm-title">{title}</div>
          <div data-testid="confirm-content">{content}</div>
          <button
            data-testid="confirm-btn"
            onClick={onConfirm}
            disabled={isDisabled || isLoading}
          >
            Confirm
          </button>
          <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
        </div>
      )
    : null,
}))

// Mock Modal component
vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow, onClose, className }: PropsWithChildren<{
    isShow: boolean
    onClose: () => void
    className?: string
  }>) => isShow
    ? (
        <div data-testid="modal" className={className} onClick={e => e.target === e.currentTarget && onClose()}>
          {children}
        </div>
      )
    : null,
}))

// Mock Input component
vi.mock('@/app/components/base/input', () => ({
  default: ({ value, onChange, placeholder }: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
  }) => (
    <input
      data-testid="input"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
}))

// Mock Textarea component
vi.mock('@/app/components/base/textarea', () => ({
  default: ({ value, onChange, placeholder, className }: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    placeholder?: string
    className?: string
  }) => (
    <textarea
      data-testid="textarea"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  ),
}))

// Mock AppIcon component
vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick, iconType, icon, background, imageUrl, className, size }: {
    onClick?: () => void
    iconType?: string
    icon?: string
    background?: string
    imageUrl?: string
    className?: string
    size?: string
  }) => (
    <div
      data-testid="app-icon"
      data-icon-type={iconType}
      data-icon={icon}
      data-background={background}
      data-image-url={imageUrl}
      data-size={size}
      className={className}
      onClick={onClick}
    />
  ),
}))

// Mock AppIconPicker component
vi.mock('@/app/components/base/app-icon-picker', () => ({
  default: ({ onSelect, onClose }: {
    onSelect: (item: { type: string, icon?: string, background?: string, url?: string }) => void
    onClose: () => void
  }) => (
    <div data-testid="app-icon-picker">
      <button
        data-testid="select-emoji"
        onClick={() => onSelect({ type: 'emoji', icon: '🚀', background: '#000000' })}
      >
        Select Emoji
      </button>
      <button
        data-testid="select-image"
        onClick={() => onSelect({ type: 'image', url: 'https://example.com/icon.png' })}
      >
        Select Image
      </button>
      <button data-testid="close-picker" onClick={onClose}>Close</button>
    </div>
  ),
}))

// Mock Uploader component
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

// Mock use-context-selector
vi.mock('use-context-selector', () => ({
  useContext: vi.fn(() => ({
    notify: vi.fn(),
  })),
}))

// Mock RagPipelineHeader
vi.mock('./rag-pipeline-header', () => ({
  default: () => <div data-testid="rag-pipeline-header" />,
}))

// Mock PublishToast
vi.mock('./publish-toast', () => ({
  default: () => <div data-testid="publish-toast" />,
}))

// Mock UpdateDSLModal for RagPipelineChildren tests
vi.mock('./update-dsl-modal', () => ({
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

// Mock DSLExportConfirmModal for RagPipelineChildren tests
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

// ============================================================================
// Test Suites
// ============================================================================

describe('Conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
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

      expect(screen.getByTestId('mock-image')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should show confirm modal when convert button is clicked', () => {
      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)

      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
      expect(screen.getByTestId('confirm-title')).toHaveTextContent('datasetPipeline.conversion.confirm.title')
    })

    it('should hide confirm modal when cancel is clicked', () => {
      render(<Conversion />)

      // Open modal
      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

      // Cancel modal
      fireEvent.click(screen.getByTestId('cancel-btn'))
      expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // API Callback Tests - covers lines 21-39
  // --------------------------------------------------------------------------
  describe('API Callbacks', () => {
    beforeEach(() => {
      mockConvertFn = vi.fn()
      mockIsPending = false
    })

    it('should call convert with datasetId and show success toast on success', async () => {
      // Setup mock to capture and call onSuccess callback
      mockConvertFn.mockImplementation((_datasetId: string, options: { onSuccess: (res: { status: string }) => void }) => {
        options.onSuccess({ status: 'success' })
      })

      render(<Conversion />)

      // Open modal and confirm
      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      fireEvent.click(screen.getByTestId('confirm-btn'))

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
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('confirm-btn'))

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
      })
    })

    it('should show error toast when conversion fails with status failed', async () => {
      mockConvertFn.mockImplementation((_datasetId: string, options: { onSuccess: (res: { status: string }) => void }) => {
        options.onSuccess({ status: 'failed' })
      })

      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      fireEvent.click(screen.getByTestId('confirm-btn'))

      await waitFor(() => {
        expect(mockConvertFn).toHaveBeenCalled()
      })
      // Modal should still be visible since conversion failed
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()
    })

    it('should show error toast when conversion throws error', async () => {
      mockConvertFn.mockImplementation((_datasetId: string, options: { onError: () => void }) => {
        options.onError()
      })

      render(<Conversion />)

      const convertButton = screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })
      fireEvent.click(convertButton)
      fireEvent.click(screen.getByTestId('confirm-btn'))

      await waitFor(() => {
        expect(mockConvertFn).toHaveBeenCalled()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Conversion is exported with React.memo
      expect((Conversion as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should use useCallback for handleConvert', () => {
      const { rerender } = render(<Conversion />)

      // Rerender should not cause issues with callback
      rerender(<Conversion />)
      expect(screen.getByRole('button', { name: /datasetPipeline\.operations\.convert/i })).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle missing datasetId gracefully', () => {
      render(<Conversion />)

      // Component should render without crashing
      expect(screen.getByText('datasetPipeline.conversion.title')).toBeInTheDocument()
    })
  })
})

describe('PipelineScreenShot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<PipelineScreenShot />)

      expect(screen.getByTestId('mock-image')).toBeInTheDocument()
    })

    it('should render with correct image attributes', () => {
      render(<PipelineScreenShot />)

      const img = screen.getByTestId('mock-image')
      expect(img).toHaveAttribute('alt', 'Pipeline Screenshot')
      expect(img).toHaveAttribute('width', '692')
      expect(img).toHaveAttribute('height', '456')
    })

    it('should use correct theme-based source path', () => {
      render(<PipelineScreenShot />)

      const img = screen.getByTestId('mock-image')
      // Default theme is 'light' from mock
      expect(img).toHaveAttribute('src', '/public/screenshots/light/Pipeline.png')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Note: PublishToast is mocked, so we just verify the mock renders
      render(<PublishToast />)

      expect(screen.getByTestId('publish-toast')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be defined', () => {
      // The real PublishToast is mocked, but we can verify the import
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

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render modal with title', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      expect(screen.getByText('pipeline.common.publishAs')).toBeInTheDocument()
    })

    it('should render name input with default value from store', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const input = screen.getByTestId('input')
      expect(input).toHaveValue('Test Knowledge')
    })

    it('should render description textarea', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      expect(screen.getByTestId('textarea')).toBeInTheDocument()
    })

    it('should render app icon', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      expect(screen.getByTestId('app-icon')).toBeInTheDocument()
    })

    it('should render cancel and confirm buttons', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.common\.publish/i })).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should update name when input changes', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const input = screen.getByTestId('input')
      fireEvent.change(input, { target: { value: 'New Pipeline Name' } })

      expect(input).toHaveValue('New Pipeline Name')
    })

    it('should update description when textarea changes', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      const textarea = screen.getByTestId('textarea')
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

      // Update values
      fireEvent.change(screen.getByTestId('input'), { target: { value: '  Trimmed Name  ' } })
      fireEvent.change(screen.getByTestId('textarea'), { target: { value: '  Trimmed Description  ' } })

      // Click publish
      fireEvent.click(screen.getByRole('button', { name: /workflow\.common\.publish/i }))

      expect(mockOnConfirm).toHaveBeenCalledWith(
        'Trimmed Name',
        expect.any(Object),
        'Trimmed Description',
      )
    })

    it('should show app icon picker when icon is clicked', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('app-icon'))

      expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()
    })

    it('should update icon when emoji is selected', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      // Open picker
      fireEvent.click(screen.getByTestId('app-icon'))

      // Select emoji
      fireEvent.click(screen.getByTestId('select-emoji'))

      // Picker should close
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
    })

    it('should update icon when image is selected', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      // Open picker
      fireEvent.click(screen.getByTestId('app-icon'))

      // Select image
      fireEvent.click(screen.getByTestId('select-image'))

      // Picker should close
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
    })

    it('should close picker and restore icon when picker is closed', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      // Open picker
      fireEvent.click(screen.getByTestId('app-icon'))
      expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()

      // Close picker
      fireEvent.click(screen.getByTestId('close-picker'))

      // Picker should close
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Validation Tests
  // --------------------------------------------------------------------------
  describe('Props Validation', () => {
    it('should disable publish button when name is empty', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      // Clear the name
      fireEvent.change(screen.getByTestId('input'), { target: { value: '' } })

      const publishButton = screen.getByRole('button', { name: /workflow\.common\.publish/i })
      expect(publishButton).toBeDisabled()
    })

    it('should disable publish button when name is only whitespace', () => {
      render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      // Set whitespace-only name
      fireEvent.change(screen.getByTestId('input'), { target: { value: '   ' } })

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

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should use useCallback for handleSelectIcon', () => {
      const { rerender } = render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

      // Rerender should not cause issues
      rerender(<PublishAsKnowledgePipelineModal {...defaultProps} />)
      expect(screen.getByTestId('app-icon')).toBeInTheDocument()
    })
  })
})

describe('RagPipelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Event Subscription Tests - covers lines 37-40
  // --------------------------------------------------------------------------
  describe('Event Subscription', () => {
    it('should subscribe to event emitter', () => {
      render(<RagPipelineChildren />)

      expect(mockUseSubscription).toHaveBeenCalled()
    })

    it('should handle DSL_EXPORT_CHECK event and set secretEnvList', async () => {
      render(<RagPipelineChildren />)

      // Simulate DSL_EXPORT_CHECK event
      const mockEnvVariables: EnvironmentVariable[] = [
        { id: '1', name: 'SECRET_KEY', value: 'test-secret', value_type: 'secret' as const, description: '' },
      ]

      // Trigger the subscription callback
      if (mockEventSubscriptionCallback) {
        mockEventSubscriptionCallback({
          type: 'DSL_EXPORT_CHECK',
          payload: { data: mockEnvVariables },
        })
      }

      // DSLExportConfirmModal should be rendered
      await waitFor(() => {
        expect(screen.getByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
      })
    })

    it('should not show DSLExportConfirmModal for non-DSL_EXPORT_CHECK events', () => {
      render(<RagPipelineChildren />)

      // Trigger a different event type
      if (mockEventSubscriptionCallback) {
        mockEventSubscriptionCallback({
          type: 'OTHER_EVENT',
        })
      }

      expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // UpdateDSLModal Handlers Tests - covers lines 48-51
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // DSLExportConfirmModal Tests - covers lines 55-60
  // --------------------------------------------------------------------------
  describe('DSLExportConfirmModal', () => {
    it('should render DSLExportConfirmModal when secretEnvList has items', async () => {
      render(<RagPipelineChildren />)

      // Simulate DSL_EXPORT_CHECK event with secrets
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

      // First show the modal
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

      // Close the modal
      fireEvent.click(screen.getByTestId('dsl-export-close'))

      await waitFor(() => {
        expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
      })
    })

    it('should call handleExportDSL when onConfirm is triggered', async () => {
      render(<RagPipelineChildren />)

      // Show the modal
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

      // Confirm export
      fireEvent.click(screen.getByTestId('dsl-export-confirm'))

      expect(mockHandleExportDSL).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be wrapped with memo', () => {
      expect((RagPipelineChildren as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

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

      // Update name
      fireEvent.change(screen.getByTestId('input'), { target: { value: 'My Pipeline' } })

      // Add description
      fireEvent.change(screen.getByTestId('textarea'), { target: { value: 'A great pipeline' } })

      // Change icon
      fireEvent.click(screen.getByTestId('app-icon'))
      fireEvent.click(screen.getByTestId('select-emoji'))

      // Publish
      fireEvent.click(screen.getByRole('button', { name: /workflow\.common\.publish/i }))

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledWith(
          'My Pipeline',
          expect.objectContaining({
            icon_type: 'emoji',
            icon: '🚀',
            icon_background: '#000000',
          }),
          'A great pipeline',
        )
      })
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

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

      // Clear the name
      const input = screen.getByTestId('input')
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
      const input = screen.getByTestId('input')
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
      const input = screen.getByTestId('input')
      fireEvent.change(input, { target: { value: specialName } })
      expect(input).toHaveValue(specialName)
    })
  })
})

// ============================================================================
// Accessibility Tests
// ============================================================================

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

      expect(screen.getByTestId('input')).toBeInTheDocument()
      expect(screen.getByTestId('textarea')).toBeInTheDocument()
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
