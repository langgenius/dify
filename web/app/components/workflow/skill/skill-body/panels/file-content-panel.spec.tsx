import type { OnMount } from '@monaco-editor/react'
import type { AppAssetTreeView } from '@/types/app-asset'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Theme } from '@/types/app'
import { START_TAB_ID } from '../../constants'
import FileContentPanel from './file-content-panel'

type AppStoreState = {
  appDetail: {
    id: string
  } | null
}

type WorkflowStoreState = {
  activeTabId: string | null
  editorAutoFocusFileId: string | null
  dirtyContents: Map<string, string>
  fileMetadata: Map<string, Record<string, unknown>>
  dirtyMetadataIds: Set<string>
}

type WorkflowStoreActions = {
  setFileMetadata: (fileId: string, metadata: Record<string, unknown>) => void
  clearDraftMetadata: (fileId: string) => void
  setDraftMetadata: (fileId: string, metadata: Record<string, unknown>) => void
  setDraftContent: (fileId: string, content: string) => void
  clearDraftContent: (fileId: string) => void
  pinTab: (fileId: string) => void
  clearEditorAutoFocus: (fileId: string) => void
}

type FileNodeViewState = 'resolving' | 'ready' | 'missing'

type FileTypeInfo = {
  isMarkdown: boolean
  isCodeOrText: boolean
  isImage: boolean
  isVideo: boolean
  isPdf: boolean
  isSQLite: boolean
  isEditable: boolean
  isPreviewable: boolean
}

type FileContentData = {
  content: string
  metadata?: Record<string, unknown> | string
}

type DownloadUrlData = {
  download_url: string
}

type SkillFileDataResult = {
  fileContent?: FileContentData
  downloadUrlData?: DownloadUrlData
  isLoading: boolean
  error: Error | null
}

type UseSkillFileDataMode = 'none' | 'content' | 'download'

type UseSkillMarkdownCollaborationArgs = {
  onLocalChange: (value: string) => void
}

type UseSkillCodeCollaborationArgs = {
  onLocalChange: (value: string) => void
}

const FILE_REFERENCE_ID = '123e4567-e89b-12d3-a456-426614174000'

const createNode = (overrides: Partial<AppAssetTreeView> = {}): AppAssetTreeView => ({
  id: 'file-1',
  node_type: 'file',
  name: 'main.ts',
  path: '/main.ts',
  extension: 'ts',
  size: 120,
  children: [],
  ...overrides,
})

const createDefaultActions = (): WorkflowStoreActions => ({
  setFileMetadata: vi.fn(),
  clearDraftMetadata: vi.fn(),
  setDraftMetadata: vi.fn(),
  setDraftContent: vi.fn(),
  clearDraftContent: vi.fn(),
  pinTab: vi.fn(),
  clearEditorAutoFocus: vi.fn(),
})

const createDefaultFileTypeInfo = (): FileTypeInfo => ({
  isMarkdown: false,
  isCodeOrText: true,
  isImage: false,
  isVideo: false,
  isPdf: false,
  isSQLite: false,
  isEditable: true,
  isPreviewable: true,
})

const createDefaultFileData = (): SkillFileDataResult => ({
  fileContent: {
    content: 'console.log("hello")',
    metadata: {},
  },
  downloadUrlData: {
    download_url: 'https://example.com/file',
  },
  isLoading: false,
  error: null,
})

const mocks = vi.hoisted(() => ({
  monacoLoaderConfig: vi.fn(),
  setMonacoTheme: vi.fn(),
  appState: {
    appDetail: {
      id: 'app-1',
    },
  } as AppStoreState,
  workflowState: {
    activeTabId: 'file-1',
    editorAutoFocusFileId: null,
    dirtyContents: new Map<string, string>(),
    fileMetadata: new Map<string, Record<string, unknown>>(),
    dirtyMetadataIds: new Set<string>(),
  } as WorkflowStoreState,
  workflowActions: {
    setFileMetadata: vi.fn(),
    clearDraftMetadata: vi.fn(),
    setDraftMetadata: vi.fn(),
    setDraftContent: vi.fn(),
    clearDraftContent: vi.fn(),
    pinTab: vi.fn(),
    clearEditorAutoFocus: vi.fn(),
  } as WorkflowStoreActions,
  nodeMapData: new Map<string, AppAssetTreeView>([['file-1', {
    id: 'file-1',
    node_type: 'file',
    name: 'main.ts',
    path: '/main.ts',
    extension: 'ts',
    size: 120,
    children: [],
  }]]),
  nodeMapStatus: {
    isLoading: false,
    isFetching: false,
    isFetched: true,
  },
  fileNodeViewState: 'ready' as FileNodeViewState,
  fileTypeInfo: {
    isMarkdown: false,
    isCodeOrText: true,
    isImage: false,
    isVideo: false,
    isPdf: false,
    isSQLite: false,
    isEditable: true,
    isPreviewable: true,
  } as FileTypeInfo,
  fileData: {
    fileContent: {
      content: 'console.log("hello")',
      metadata: {},
    },
    downloadUrlData: {
      download_url: 'https://example.com/file',
    },
    isLoading: false,
    error: null,
  } as SkillFileDataResult,
  appTheme: 'light' as Theme,
  saveFile: vi.fn(),
  registerFallback: vi.fn(),
  unregisterFallback: vi.fn(),
  useSkillFileData: vi.fn(),
  useSkillMarkdownCollaboration: vi.fn(),
  useSkillCodeCollaboration: vi.fn(),
  getFileLanguage: vi.fn<(name: string) => string>(() => 'typescript'),
}))

vi.mock('@monaco-editor/react', () => ({
  loader: {
    config: (...args: unknown[]) => mocks.monacoLoaderConfig(...args),
  },
}))

vi.mock('next/dynamic', () => ({
  default: () => {
    return ({ downloadUrl }: { downloadUrl: string }) => (
      <div data-testid="dynamic-preview">{downloadUrl}</div>
    )
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: AppStoreState) => unknown) => selector(mocks.appState),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: WorkflowStoreState) => unknown) => selector(mocks.workflowState),
  useWorkflowStore: () => ({
    getState: () => mocks.workflowActions,
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mocks.appTheme }),
}))

vi.mock('../../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useSkillAssetNodeMap: () => ({
    data: mocks.nodeMapData,
    isLoading: mocks.nodeMapStatus.isLoading,
    isFetching: mocks.nodeMapStatus.isFetching,
    isFetched: mocks.nodeMapStatus.isFetched,
  }),
}))

vi.mock('../../hooks/use-file-node-view-state', () => ({
  useFileNodeViewState: () => mocks.fileNodeViewState,
}))

vi.mock('../../hooks/use-file-type-info', () => ({
  useFileTypeInfo: () => mocks.fileTypeInfo,
}))

vi.mock('../../hooks/use-skill-file-data', () => ({
  useSkillFileData: (appId: string, fileId: string | null, mode: UseSkillFileDataMode) => {
    mocks.useSkillFileData(appId, fileId, mode)
    return mocks.fileData
  },
}))

vi.mock('../../hooks/skill-save-context', () => ({
  useSkillSaveManager: () => ({
    saveFile: mocks.saveFile,
    registerFallback: mocks.registerFallback,
    unregisterFallback: mocks.unregisterFallback,
  }),
}))

vi.mock('../../../collaboration/skills/use-skill-markdown-collaboration', () => ({
  useSkillMarkdownCollaboration: (args: UseSkillMarkdownCollaborationArgs) => {
    mocks.useSkillMarkdownCollaboration(args)
    return {
      handleCollaborativeChange: (value: string) => args.onLocalChange(value),
    }
  },
}))

vi.mock('../../../collaboration/skills/use-skill-code-collaboration', () => ({
  useSkillCodeCollaboration: (args: UseSkillCodeCollaborationArgs) => {
    mocks.useSkillCodeCollaboration(args)
    return {
      handleCollaborativeChange: (value: string | undefined) => args.onLocalChange(value ?? ''),
    }
  },
}))

vi.mock('../../start-tab', () => ({
  default: () => <div data-testid="start-tab-content" />,
}))

vi.mock('../../editor/markdown-file-editor', () => ({
  default: ({
    value,
    onChange,
    autoFocus,
    onAutoFocus,
    collaborationEnabled,
  }: {
    value: string
    onChange: (value: string) => void
    autoFocus?: boolean
    onAutoFocus?: () => void
    collaborationEnabled?: boolean
  }) => (
    <div data-testid="markdown-editor">
      <span>{`value:${value}`}</span>
      <span>{`autoFocus:${String(Boolean(autoFocus))}`}</span>
      <span>{`collaboration:${String(Boolean(collaborationEnabled))}`}</span>
      <button type="button" onClick={() => onChange(`linked §[file].[app].[${FILE_REFERENCE_ID}]§`)}>
        markdown-change
      </button>
      <button type="button" onClick={() => onChange('plain-markdown')}>
        markdown-no-ref
      </button>
      <button type="button" onClick={onAutoFocus}>
        markdown-autofocus
      </button>
    </div>
  ),
}))

vi.mock('../../editor/code-file-editor', () => ({
  default: ({
    value,
    onChange,
    onMount,
    onAutoFocus,
    theme,
    language,
  }: {
    value: string
    onChange: (value: string | undefined) => void
    onMount: OnMount
    onAutoFocus?: () => void
    theme: string
    language: string
  }) => (
    <div data-testid="code-editor">
      <span>{`value:${value}`}</span>
      <span>{`theme:${theme}`}</span>
      <span>{`language:${language}`}</span>
      <button type="button" onClick={() => onChange('updated-code')}>
        code-change
      </button>
      <button type="button" onClick={() => onChange(undefined)}>
        code-clear
      </button>
      <button type="button" onClick={onAutoFocus}>
        code-autofocus
      </button>
      <button
        type="button"
        onClick={() => {
          const monaco = {
            editor: {
              setTheme: mocks.setMonacoTheme,
            },
          } as unknown as Parameters<OnMount>[1]
          onMount({} as Parameters<OnMount>[0], monaco)
        }}
      >
        code-mount
      </button>
    </div>
  ),
}))

vi.mock('../../viewer/media-file-preview', () => ({
  default: ({ type, src }: { type: 'image' | 'video', src: string }) => (
    <div data-testid="media-preview">{`${type}|${src}`}</div>
  ),
}))

vi.mock('../../viewer/unsupported-file-download', () => ({
  default: ({ name, size, downloadUrl }: { name: string, size?: number, downloadUrl: string }) => (
    <div data-testid="unsupported-preview">{`${name}|${String(size)}|${downloadUrl}`}</div>
  ),
}))

vi.mock('../../utils/file-utils', async () => {
  const actual = await vi.importActual<typeof import('../../utils/file-utils')>('../../utils/file-utils')
  return {
    ...actual,
    getFileLanguage: (name: string) => mocks.getFileLanguage(name),
  }
})

describe('FileContentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appState.appDetail = { id: 'app-1' }
    mocks.workflowState.activeTabId = 'file-1'
    mocks.workflowState.editorAutoFocusFileId = null
    mocks.workflowState.dirtyContents = new Map<string, string>()
    mocks.workflowState.fileMetadata = new Map<string, Record<string, unknown>>()
    mocks.workflowState.dirtyMetadataIds = new Set<string>()
    mocks.workflowActions = createDefaultActions()
    mocks.nodeMapData = new Map<string, AppAssetTreeView>([['file-1', createNode()]])
    mocks.nodeMapStatus = {
      isLoading: false,
      isFetching: false,
      isFetched: true,
    }
    mocks.fileNodeViewState = 'ready'
    mocks.fileTypeInfo = createDefaultFileTypeInfo()
    mocks.fileData = createDefaultFileData()
    mocks.appTheme = Theme.light
  })

  describe('Rendering states', () => {
    it('should render start tab content when active tab is start tab', () => {
      // Arrange
      mocks.workflowState.activeTabId = START_TAB_ID

      // Act
      render(<FileContentPanel />)

      // Assert
      expect(screen.getByTestId('start-tab-content')).toBeInTheDocument()
      expect(mocks.useSkillFileData).toHaveBeenCalledWith('app-1', null, 'none')
    })

    it('should render empty state when no file tab is selected', () => {
      // Arrange
      mocks.workflowState.activeTabId = null

      // Act
      render(<FileContentPanel />)

      // Assert
      expect(screen.getByText('workflow.skillSidebar.empty')).toBeInTheDocument()
    })

    it('should render loading indicator when file node is resolving', () => {
      // Arrange
      mocks.fileNodeViewState = 'resolving'

      // Act
      render(<FileContentPanel />)

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render load error when selected file is missing', () => {
      // Arrange
      mocks.fileNodeViewState = 'missing'

      // Act
      render(<FileContentPanel />)

      // Assert
      expect(screen.getByText('workflow.skillSidebar.loadError')).toBeInTheDocument()
    })

    it('should render loading indicator when file data is loading', () => {
      // Arrange
      mocks.fileData.isLoading = true

      // Act
      render(<FileContentPanel />)

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render load error when file data query fails', () => {
      // Arrange
      mocks.fileData.error = new Error('failed')

      // Act
      render(<FileContentPanel />)

      // Assert
      expect(screen.getByText('workflow.skillSidebar.loadError')).toBeInTheDocument()
    })
  })

  describe('Editor interactions', () => {
    it('should render markdown editor and update draft metadata when content references files', async () => {
      // Arrange
      mocks.fileTypeInfo = {
        isMarkdown: true,
        isCodeOrText: false,
        isImage: false,
        isVideo: false,
        isPdf: false,
        isSQLite: false,
        isEditable: true,
        isPreviewable: true,
      }
      mocks.workflowState.fileMetadata = new Map<string, Record<string, unknown>>([
        ['file-1', {}],
      ])
      mocks.workflowState.editorAutoFocusFileId = 'file-1'
      mocks.nodeMapData = new Map<string, AppAssetTreeView>([
        ['file-1', createNode({ name: 'prompt.md', extension: 'md' })],
        [FILE_REFERENCE_ID, createNode({ id: FILE_REFERENCE_ID, name: 'kb.txt', extension: 'txt' })],
      ])

      // Act
      render(<FileContentPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'markdown-change' }))
      fireEvent.click(screen.getByRole('button', { name: 'markdown-autofocus' }))

      // Assert
      expect(screen.getByTestId('markdown-editor')).toBeInTheDocument()
      expect(mocks.workflowActions.setDraftContent).toHaveBeenCalledTimes(1)
      expect(mocks.workflowActions.pinTab).toHaveBeenCalledWith('file-1')
      expect(mocks.workflowActions.setDraftMetadata).toHaveBeenCalledWith(
        'file-1',
        expect.objectContaining({
          files: expect.objectContaining({
            [FILE_REFERENCE_ID]: expect.objectContaining({ id: FILE_REFERENCE_ID }),
          }),
        }),
      )
      expect(mocks.workflowActions.clearEditorAutoFocus).toHaveBeenCalledWith('file-1')
    })

    it('should clear draft content when code editor value matches original content', () => {
      // Arrange
      mocks.fileData.fileContent = {
        content: '',
        metadata: {},
      }

      // Act
      render(<FileContentPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'code-clear' }))

      // Assert
      expect(screen.getByTestId('code-editor')).toBeInTheDocument()
      expect(mocks.workflowActions.clearDraftContent).toHaveBeenCalledWith('file-1')
      expect(mocks.workflowActions.pinTab).toHaveBeenCalledWith('file-1')
    })

    it('should switch editor theme after monaco mount callback runs', async () => {
      // Arrange
      mocks.appTheme = Theme.light

      // Act
      render(<FileContentPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'code-mount' }))

      // Assert
      expect(mocks.setMonacoTheme).toHaveBeenCalledWith('light')
      await waitFor(() => {
        expect(screen.getByText('theme:light')).toBeInTheDocument()
      })
    })

    it('should call save manager when collaboration leader sync is requested', () => {
      // Arrange
      render(<FileContentPanel />)
      const firstCall = mocks.useSkillCodeCollaboration.mock.calls[0]
      const args = firstCall?.[0] as { onLeaderSync: () => void } | undefined

      // Act
      args?.onLeaderSync()

      // Assert
      expect(mocks.saveFile).toHaveBeenCalledWith('file-1')
    })

    it('should ignore editor content updates when file is not editable', () => {
      // Arrange
      mocks.fileTypeInfo = {
        isMarkdown: false,
        isCodeOrText: true,
        isImage: false,
        isVideo: false,
        isPdf: false,
        isSQLite: false,
        isEditable: false,
        isPreviewable: true,
      }

      // Act
      render(<FileContentPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'code-change' }))

      // Assert
      expect(mocks.workflowActions.setDraftContent).not.toHaveBeenCalled()
      expect(mocks.workflowActions.clearDraftContent).not.toHaveBeenCalled()
      expect(mocks.workflowActions.pinTab).not.toHaveBeenCalled()
    })

    it('should skip leader sync save when file is not editable', () => {
      // Arrange
      mocks.fileTypeInfo = {
        isMarkdown: false,
        isCodeOrText: true,
        isImage: false,
        isVideo: false,
        isPdf: false,
        isSQLite: false,
        isEditable: false,
        isPreviewable: true,
      }
      render(<FileContentPanel />)
      const firstCall = mocks.useSkillCodeCollaboration.mock.calls[0]
      const args = firstCall?.[0] as { onLeaderSync: () => void } | undefined

      // Act
      args?.onLeaderSync()

      // Assert
      expect(mocks.saveFile).not.toHaveBeenCalled()
    })
  })

  describe('Preview modes', () => {
    it('should render media preview and request download mode for image files', () => {
      // Arrange
      mocks.fileTypeInfo = {
        isMarkdown: false,
        isCodeOrText: false,
        isImage: true,
        isVideo: false,
        isPdf: false,
        isSQLite: false,
        isEditable: false,
        isPreviewable: true,
      }
      mocks.fileData.downloadUrlData = { download_url: 'https://example.com/image.png' }
      mocks.nodeMapData = new Map<string, AppAssetTreeView>([
        ['file-1', createNode({ name: 'image.png', extension: 'png' })],
      ])

      // Act
      render(<FileContentPanel />)

      // Assert
      expect(screen.getByTestId('media-preview')).toHaveTextContent('image|https://example.com/image.png')
      expect(mocks.useSkillFileData).toHaveBeenCalledWith('app-1', 'file-1', 'download')
    })

    it('should render unsupported download panel for non-previewable files', () => {
      // Arrange
      mocks.fileTypeInfo = {
        isMarkdown: false,
        isCodeOrText: false,
        isImage: false,
        isVideo: false,
        isPdf: false,
        isSQLite: false,
        isEditable: false,
        isPreviewable: false,
      }
      mocks.fileData.downloadUrlData = { download_url: 'https://example.com/archive.bin' }
      mocks.nodeMapData = new Map<string, AppAssetTreeView>([
        ['file-1', createNode({ name: 'archive.bin', extension: 'bin', size: 99 })],
      ])

      // Act
      render(<FileContentPanel />)

      // Assert
      expect(screen.getByTestId('unsupported-preview')).toHaveTextContent('archive.bin|99|https://example.com/archive.bin')
    })
  })

  describe('Metadata and save lifecycle', () => {
    it('should sync metadata from file content when metadata is not dirty', async () => {
      // Arrange
      mocks.fileData.fileContent = {
        content: 'markdown',
        metadata: '{"source":"api"}',
      }

      // Act
      render(<FileContentPanel />)

      // Assert
      await waitFor(() => {
        expect(mocks.workflowActions.setFileMetadata).toHaveBeenCalledWith(
          'file-1',
          expect.objectContaining({ source: 'api' }),
        )
      })
      expect(mocks.workflowActions.clearDraftMetadata).toHaveBeenCalledWith('file-1')
    })

    it('should fallback to empty metadata when metadata json is invalid', async () => {
      // Arrange
      mocks.fileData.fileContent = {
        content: 'markdown',
        metadata: '{invalid-json}',
      }

      // Act
      render(<FileContentPanel />)

      // Assert
      await waitFor(() => {
        expect(mocks.workflowActions.setFileMetadata).toHaveBeenCalledWith('file-1', {})
      })
      expect(mocks.workflowActions.clearDraftMetadata).toHaveBeenCalledWith('file-1')
    })

    it('should skip metadata sync when current metadata is marked dirty', async () => {
      // Arrange
      mocks.workflowState.dirtyMetadataIds = new Set(['file-1'])
      mocks.fileData.fileContent = {
        content: 'markdown',
        metadata: '{"source":"api"}',
      }

      // Act
      render(<FileContentPanel />)

      // Assert
      await waitFor(() => {
        expect(mocks.workflowActions.setFileMetadata).not.toHaveBeenCalled()
      })
    })

    it('should remove file references from draft metadata when markdown no longer contains references', () => {
      // Arrange
      mocks.fileTypeInfo = {
        isMarkdown: true,
        isCodeOrText: false,
        isImage: false,
        isVideo: false,
        isPdf: false,
        isSQLite: false,
        isEditable: true,
        isPreviewable: true,
      }
      mocks.workflowState.fileMetadata = new Map<string, Record<string, unknown>>([
        ['file-1', {
          files: {
            [FILE_REFERENCE_ID]: createNode({ id: FILE_REFERENCE_ID, name: 'kb.txt', extension: 'txt' }),
          },
        }],
      ])
      mocks.nodeMapData = new Map<string, AppAssetTreeView>([
        ['file-1', createNode({ name: 'prompt.md', extension: 'md' })],
      ])

      // Act
      render(<FileContentPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'markdown-no-ref' }))

      // Assert
      expect(mocks.workflowActions.setDraftMetadata).toHaveBeenCalledWith('file-1', {})
    })

    it('should keep draft metadata unchanged when referenced files match existing metadata', () => {
      // Arrange
      mocks.fileTypeInfo = {
        isMarkdown: true,
        isCodeOrText: false,
        isImage: false,
        isVideo: false,
        isPdf: false,
        isSQLite: false,
        isEditable: true,
        isPreviewable: true,
      }
      const referencedNode = createNode({ id: FILE_REFERENCE_ID, name: 'kb.txt', extension: 'txt' })
      mocks.workflowState.fileMetadata = new Map<string, Record<string, unknown>>([
        ['file-1', {
          files: {
            [FILE_REFERENCE_ID]: referencedNode,
          },
        }],
      ])
      mocks.nodeMapData = new Map<string, AppAssetTreeView>([
        ['file-1', createNode({ name: 'prompt.md', extension: 'md' })],
        [FILE_REFERENCE_ID, referencedNode],
      ])

      // Act
      render(<FileContentPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'markdown-change' }))

      // Assert
      expect(mocks.workflowActions.setDraftMetadata).not.toHaveBeenCalled()
    })

    it('should keep metadata unchanged when reference can be resolved from existing metadata only', () => {
      // Arrange
      mocks.fileTypeInfo = {
        isMarkdown: true,
        isCodeOrText: false,
        isImage: false,
        isVideo: false,
        isPdf: false,
        isSQLite: false,
        isEditable: true,
        isPreviewable: true,
      }
      const existingReferencedNode = createNode({
        id: FILE_REFERENCE_ID,
        name: 'persisted.txt',
        extension: 'txt',
      })
      mocks.workflowState.fileMetadata = new Map<string, Record<string, unknown>>([
        ['file-1', {
          files: {
            [FILE_REFERENCE_ID]: existingReferencedNode,
          },
        }],
      ])
      mocks.nodeMapData = new Map<string, AppAssetTreeView>([
        ['file-1', createNode({ name: 'prompt.md', extension: 'md' })],
      ])

      // Act
      render(<FileContentPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'markdown-change' }))

      // Assert
      expect(mocks.workflowActions.setDraftContent).toHaveBeenCalledWith(
        'file-1',
        `linked §[file].[app].[${FILE_REFERENCE_ID}]§`,
      )
      expect(mocks.workflowActions.setDraftMetadata).not.toHaveBeenCalled()
    })

    it('should register fallback on mount and persist fallback on unmount for editable file', () => {
      // Arrange
      mocks.workflowState.fileMetadata = new Map<string, Record<string, unknown>>([
        ['file-1', { language: 'ts' }],
      ])
      mocks.fileData.fileContent = {
        content: 'draft-base',
        metadata: { language: 'ts' },
      }

      // Act
      const { unmount } = render(<FileContentPanel />)

      // Assert
      expect(mocks.registerFallback).toHaveBeenCalledWith(
        'file-1',
        expect.objectContaining({
          content: 'draft-base',
          metadata: expect.objectContaining({ language: 'ts' }),
        }),
      )

      // Act
      unmount()

      // Assert
      expect(mocks.unregisterFallback).toHaveBeenCalledWith('file-1')
      expect(mocks.saveFile).toHaveBeenCalledWith(
        'file-1',
        expect.objectContaining({
          fallbackContent: 'draft-base',
          fallbackMetadata: expect.objectContaining({ language: 'ts' }),
        }),
      )
    })
  })
})
