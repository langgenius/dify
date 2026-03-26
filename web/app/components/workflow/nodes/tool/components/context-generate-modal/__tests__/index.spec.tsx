import type { ContextGenerateModalHandle } from '../index'
import type { ContextGenerateResponse } from '@/contract/console/generator'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import ContextGenerateModal from '../index'

const {
  mockHandleFetchSuggestedQuestions,
  mockAbortSuggestedQuestions,
  mockResetSuggestions,
  mockHandleReset,
  mockHandleGenerate,
  mockHandleModelChange,
  mockHandleCompletionParamsChange,
  mockHandleNodeDataUpdateWithSyncDraft,
  mockSetInitShowLastRunTab,
  mockSetPendingSingleRun,
  mockLeftPanel,
  mockRightPanel,
} = vi.hoisted(() => ({
  mockHandleFetchSuggestedQuestions: vi.fn(() => Promise.resolve()),
  mockAbortSuggestedQuestions: vi.fn(),
  mockResetSuggestions: vi.fn(),
  mockHandleReset: vi.fn(),
  mockHandleGenerate: vi.fn(),
  mockHandleModelChange: vi.fn(),
  mockHandleCompletionParamsChange: vi.fn(),
  mockHandleNodeDataUpdateWithSyncDraft: vi.fn(),
  mockSetInitShowLastRunTab: vi.fn(),
  mockSetPendingSingleRun: vi.fn(),
  mockLeftPanel: vi.fn(),
  mockRightPanel: vi.fn(),
}))
let mockConfigsMap: { flowId?: string } | undefined = { flowId: 'flow-1' }

type MockWorkflowNode = {
  id: string
  data: {
    code_language: CodeLanguage
    code: string
    outputs?: {
      result: { type: VarType, children: null }
    }
    variables?: Array<{ variable: string, value_selector: string[] | null }>
    _singleRunningStatus?: NodeRunningStatus
  }
}

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode
    onOpenChange?: (open: boolean) => void
  }) => (
    <div data-testid="dialog">
      <button type="button" onClick={() => onOpenChange?.(false)}>dialog-close</button>
      <button type="button" onClick={() => onOpenChange?.(true)}>dialog-open</button>
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogCloseButton: () => <button type="button">close-button</button>,
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap: typeof mockConfigsMap }) => unknown) => selector({
    configsMap: mockConfigsMap,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-node-data-update', () => ({
  useNodeDataUpdate: () => ({
    handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
  }),
}))

const workflowNodes: MockWorkflowNode[] = [
  {
    id: 'code-node',
    data: {
      code_language: CodeLanguage.python3,
      code: 'print("hello")',
      outputs: {
        result: { type: VarType.string, children: null },
      },
      variables: [{ variable: 'result', value_selector: ['result'] }],
      _singleRunningStatus: NodeRunningStatus.NotStart,
    },
  },
]

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { nodes: typeof workflowNodes }) => unknown) => selector({ nodes: workflowNodes }),
  useWorkflowStore: () => ({
    getState: () => ({
      setInitShowLastRunTab: mockSetInitShowLastRunTab,
      setPendingSingleRun: mockSetPendingSingleRun,
    }),
  }),
}))

vi.mock('../hooks/use-resizable-panels', () => ({
  default: () => ({
    rightContainerRef: { current: null },
    resolvedCodePanelHeight: 240,
    handleResizeStart: vi.fn(),
  }),
}))

const defaultCurrentVersion: ContextGenerateResponse = {
  variables: [{ variable: 'result', value_selector: ['result'] }],
  outputs: { result: { type: 'string' } },
  code_language: CodeLanguage.javascript,
  code: 'return result',
  message: '',
  error: '',
}

const mockUseContextGenerate = vi.fn()
vi.mock('../hooks/use-context-generate', async () => {
  const actual = await vi.importActual<typeof import('../hooks/use-context-generate')>('../hooks/use-context-generate')
  return {
    ...actual,
    default: (...args: unknown[]) => mockUseContextGenerate(...args),
  }
})

vi.mock('../components/left-panel', () => ({
  default: (props: {
    onReset?: () => void
  }) => {
    mockLeftPanel(props)
    return (
      <div data-testid="left-panel">
        <button type="button" onClick={() => props.onReset?.()}>left-reset</button>
      </div>
    )
  },
}))

vi.mock('../components/right-panel', () => ({
  default: (props: {
    onRun?: () => void
    onApply?: () => void
    onClose?: () => void
  }) => {
    mockRightPanel(props)
    return (
      <div data-testid="right-panel">
        <button type="button" onClick={() => props.onRun?.()}>run</button>
        <button type="button" onClick={() => props.onApply?.()}>apply</button>
        <button type="button" onClick={() => props.onClose?.()}>close</button>
      </div>
    )
  },
}))

type MockContextGenerateReturn = {
  current: ContextGenerateResponse | null
  currentVersionIndex: number
  setCurrentVersionIndex: ReturnType<typeof vi.fn>
  promptMessages: Array<{ id?: string, role: string, content: string }>
  inputValue: string
  setInputValue: ReturnType<typeof vi.fn>
  suggestedQuestions: string[]
  hasFetchedSuggestions: boolean
  isGenerating: boolean
  model: {
    provider: string
    name: string
    mode: string
    completion_params: Record<string, unknown>
  }
  handleModelChange: typeof mockHandleModelChange
  handleCompletionParamsChange: typeof mockHandleCompletionParamsChange
  handleGenerate: typeof mockHandleGenerate
  handleReset: typeof mockHandleReset
  handleFetchSuggestedQuestions: typeof mockHandleFetchSuggestedQuestions
  abortSuggestedQuestions: typeof mockAbortSuggestedQuestions
  resetSuggestions: typeof mockResetSuggestions
  defaultAssistantMessage: string
  versionOptions: Array<{ index: number, label: string }>
  currentVersionLabel: string
  isInitView: boolean
  availableVars: unknown[]
  availableNodes: unknown[]
}

const createHookReturn = (overrides: Partial<MockContextGenerateReturn> = {}): MockContextGenerateReturn => ({
  current: defaultCurrentVersion,
  currentVersionIndex: 0,
  setCurrentVersionIndex: vi.fn(),
  promptMessages: [],
  inputValue: '',
  setInputValue: vi.fn(),
  suggestedQuestions: [],
  hasFetchedSuggestions: true,
  isGenerating: false,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  },
  handleModelChange: mockHandleModelChange,
  handleCompletionParamsChange: mockHandleCompletionParamsChange,
  handleGenerate: mockHandleGenerate,
  handleReset: mockHandleReset,
  handleFetchSuggestedQuestions: mockHandleFetchSuggestedQuestions,
  abortSuggestedQuestions: mockAbortSuggestedQuestions,
  resetSuggestions: mockResetSuggestions,
  defaultAssistantMessage: 'Default assistant message',
  versionOptions: [{ index: 0, label: 'Version 1' }],
  currentVersionLabel: 'Version 1',
  isInitView: false,
  availableVars: [],
  availableNodes: [],
  ...overrides,
})

describe('ContextGenerateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigsMap = { flowId: 'flow-1' }
    mockUseContextGenerate.mockReturnValue(createHookReturn())
    workflowNodes[0].data = {
      code_language: CodeLanguage.python3,
      code: 'print("hello")',
      outputs: {
        result: { type: VarType.string, children: null },
      },
      variables: [{ variable: 'result', value_selector: ['result'] }],
      _singleRunningStatus: NodeRunningStatus.NotStart,
    }
  })

  it('should expose onOpen through the imperative ref and pass fallback data to the right panel', async () => {
    const ref = { current: null } as React.MutableRefObject<ContextGenerateModalHandle | null>

    render(
      <ContextGenerateModal
        ref={ref}
        isShow
        onClose={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
      />,
    )

    await act(async () => {
      ref.current?.onOpen()
    })

    expect(mockHandleFetchSuggestedQuestions).toHaveBeenCalledTimes(1)
    expect(mockRightPanel).toHaveBeenCalledWith(expect.objectContaining({
      displayVersion: defaultCurrentVersion,
      canApply: true,
      canRun: true,
    }))
  })

  it('should apply generated code to the node and close when apply is triggered', () => {
    const onClose = vi.fn()

    render(
      <ContextGenerateModal
        isShow
        onClose={onClose}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'apply' }))

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(expect.objectContaining({
      id: 'code-node',
      data: expect.objectContaining({
        code_language: CodeLanguage.javascript,
        code: 'return result',
      }),
    }), { sync: true })
    expect(mockAbortSuggestedQuestions).toHaveBeenCalled()
    expect(mockResetSuggestions).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('should fall back to pending single run when there is no internal view callback', () => {
    render(
      <ContextGenerateModal
        isShow
        onClose={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'run' }))

    expect(mockSetInitShowLastRunTab).toHaveBeenCalledWith(true)
    expect(mockSetPendingSingleRun).toHaveBeenCalledWith({
      nodeId: 'code-node',
      action: 'run',
    })
  })

  it('should delegate run to the internal view flow when provided', () => {
    const onOpenInternalViewAndRun = vi.fn()
    const onClose = vi.fn()

    render(
      <ContextGenerateModal
        isShow
        onClose={onClose}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
        onOpenInternalViewAndRun={onOpenInternalViewAndRun}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'run' }))

    expect(onOpenInternalViewAndRun).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockSetPendingSingleRun).not.toHaveBeenCalled()
  })

  it('should render fallback code data when there is no generated version and expose non-runnable empty states', () => {
    mockUseContextGenerate.mockReturnValue(createHookReturn({
      current: null,
      isInitView: false,
    }))

    render(
      <ContextGenerateModal
        isShow
        onClose={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
      />,
    )

    expect(mockRightPanel).toHaveBeenCalledWith(expect.objectContaining({
      displayVersion: expect.objectContaining({
        code: 'print("hello")',
      }),
      canApply: false,
      canRun: true,
    }))
  })

  it('should handle reset and dialog close flows by refetching suggestions and clearing transient state', () => {
    const onClose = vi.fn()

    render(
      <ContextGenerateModal
        isShow
        onClose={onClose}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'left-reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'dialog-close' }))

    expect(mockAbortSuggestedQuestions).toHaveBeenCalledTimes(2)
    expect(mockHandleReset).toHaveBeenCalledTimes(1)
    expect(mockResetSuggestions).toHaveBeenCalledTimes(2)
    expect(mockHandleFetchSuggestedQuestions).toHaveBeenCalledWith({ force: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should treat running code nodes as running and no-op run when the code node id is missing', () => {
    workflowNodes[0].data._singleRunningStatus = NodeRunningStatus.Running
    mockUseContextGenerate.mockReturnValue(createHookReturn({
      current: null,
    }))

    render(
      <ContextGenerateModal
        isShow
        onClose={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId=""
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'run' }))

    expect(mockRightPanel).toHaveBeenCalledWith(expect.objectContaining({
      isRunning: false,
      canRun: false,
      canApply: false,
    }))
    expect(mockSetPendingSingleRun).not.toHaveBeenCalled()
  })

  it('should build fallback data from the stored code node when outputs are missing and the flow id is absent', () => {
    mockConfigsMap = undefined
    workflowNodes[0].data = {
      code_language: CodeLanguage.python3,
      code: '',
      outputs: undefined,
      variables: [{ variable: 'result', value_selector: null }],
      _singleRunningStatus: NodeRunningStatus.NotStart,
    }
    mockUseContextGenerate.mockReturnValue(createHookReturn({
      current: null,
      isInitView: false,
    }))

    render(
      <ContextGenerateModal
        isShow
        onClose={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
      />,
    )

    expect(mockUseContextGenerate).toHaveBeenCalledWith(expect.objectContaining({
      storageKey: 'unknown-tool-node-query',
    }))
    expect(mockRightPanel).toHaveBeenCalledWith(expect.objectContaining({
      displayVersion: expect.objectContaining({
        code: '',
        outputs: {},
        variables: [{ variable: 'result', value_selector: [] }],
      }),
      canRun: false,
    }))
  })

  it('should keep the modal open when the dialog open state stays true and expose the init-view right panel state', () => {
    const onClose = vi.fn()
    mockUseContextGenerate.mockReturnValue(createHookReturn({
      current: null,
      isInitView: true,
    }))

    render(
      <ContextGenerateModal
        isShow
        onClose={onClose}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'dialog-open' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(mockRightPanel).toHaveBeenCalledWith(expect.objectContaining({
      isInitView: true,
      displayVersion: null,
    }))
  })

  it('should skip applying when current data is missing and normalize unsupported output types on apply', () => {
    const onClose = vi.fn()
    mockUseContextGenerate.mockReturnValueOnce(createHookReturn({
      current: null,
      isInitView: false,
    }))

    const { rerender } = render(
      <ContextGenerateModal
        isShow
        onClose={onClose}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="missing-node"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'apply' }))
    expect(mockHandleNodeDataUpdateWithSyncDraft).not.toHaveBeenCalled()

    mockUseContextGenerate.mockReturnValue(createHookReturn({
      current: {
        ...defaultCurrentVersion,
        outputs: {
          custom: { type: 'unsupported-type' },
        },
        variables: [{ variable: 'custom', value_selector: null as unknown as string[] }],
      },
      isInitView: false,
    }))

    rerender(
      <ContextGenerateModal
        isShow
        onClose={onClose}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'apply' }))

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(expect.objectContaining({
      id: 'code-node',
      data: expect.objectContaining({
        outputs: {
          custom: {
            type: VarType.string,
            children: null,
          },
        },
        variables: [{ variable: 'custom', value_selector: [] }],
      }),
    }), { sync: true })
  })

  it('should run without applying when no current generated version exists', () => {
    const onOpenInternalViewAndRun = vi.fn()
    mockUseContextGenerate.mockReturnValue(createHookReturn({
      current: null,
      isInitView: false,
    }))

    render(
      <ContextGenerateModal
        isShow
        onClose={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        codeNodeId="code-node"
        onOpenInternalViewAndRun={onOpenInternalViewAndRun}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'run' }))

    expect(mockHandleNodeDataUpdateWithSyncDraft).not.toHaveBeenCalled()
    expect(onOpenInternalViewAndRun).toHaveBeenCalledTimes(1)
  })
})
