/**
 * VibePanel Component Tests
 *
 * Covers rendering states, user interactions, and edge cases for the vibe panel.
 */

import type { Shape as WorkflowState } from '@/app/components/workflow/store/workflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Toast from '@/app/components/base/toast'
import { WorkflowContext } from '@/app/components/workflow/context'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { VIBE_APPLY_EVENT, VIBE_COMMAND_EVENT } from '../../constants'
import VibePanel from './index'

// ============================================================================
// Mocks
// ============================================================================

const mockCopy = vi.hoisted(() => vi.fn())
const mockUseVibeFlowData = vi.hoisted(() => vi.fn())

vi.mock('copy-to-clipboard', () => ({
  default: mockCopy,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({ defaultModel: null }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  __esModule: true,
  default: ({ modelId, provider }: { modelId: string, provider: string }) => (
    <div data-testid="model-parameter-modal" data-model-id={modelId} data-provider={provider} />
  ),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-vibe', () => ({
  useVibeFlowData: () => mockUseVibeFlowData(),
}))

vi.mock('@/app/components/workflow/workflow-preview', () => ({
  __esModule: true,
  default: ({ nodes, edges }: { nodes: Node[], edges: Edge[] }) => (
    <div data-testid="workflow-preview" data-nodes-count={nodes.length} data-edges-count={edges.length} />
  ),
}))

// ============================================================================
// Test Utilities
// ============================================================================

type FlowGraph = {
  nodes: Node[]
  edges: Edge[]
}

type VibeFlowData = {
  versions: FlowGraph[]
  currentVersionIndex: number
  setCurrentVersionIndex: (index: number) => void
  current?: FlowGraph
}

const createMockNode = (overrides: Partial<Node> = {}): Node => ({
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    title: 'Start',
    desc: '',
    type: BlockEnum.Start,
  },
  ...overrides,
})

const createMockEdge = (overrides: Partial<Edge> = {}): Edge => ({
  id: 'edge-1',
  source: 'node-1',
  target: 'node-2',
  data: {
    sourceType: BlockEnum.Start,
    targetType: BlockEnum.End,
  },
  ...overrides,
})

const createFlowGraph = (overrides: Partial<FlowGraph> = {}): FlowGraph => ({
  nodes: [],
  edges: [],
  ...overrides,
})

const createVibeFlowData = (overrides: Partial<VibeFlowData> = {}): VibeFlowData => ({
  versions: [],
  currentVersionIndex: 0,
  setCurrentVersionIndex: vi.fn(),
  current: undefined,
  ...overrides,
})

const renderVibePanel = ({
  workflowState,
  vibeFlowData,
}: {
  workflowState?: Partial<WorkflowState>
  vibeFlowData?: VibeFlowData
} = {}) => {
  if (vibeFlowData)
    mockUseVibeFlowData.mockReturnValue(vibeFlowData)

  const workflowStore = createWorkflowStore({})
  const vibeFlowState = vibeFlowData
    ? {
        vibeFlowVersions: vibeFlowData.versions,
        vibeFlowCurrentIndex: vibeFlowData.currentVersionIndex,
        currentVibeFlow: vibeFlowData.current,
      }
    : {}

  workflowStore.setState({
    showVibePanel: true,
    isVibeGenerating: false,
    vibePanelInstruction: '',
    vibePanelMermaidCode: '',
    ...vibeFlowState,
    ...workflowState,
  })

  const hooksStore = createHooksStore({})

  return {
    workflowStore,
    ...render(
      <WorkflowContext.Provider value={workflowStore}>
        <HooksStoreContext.Provider value={hooksStore}>
          <VibePanel />
        </HooksStoreContext.Provider>
      </WorkflowContext.Provider>,
    ),
  }
}

const getCopyButton = () => {
  const buttons = screen.getAllByRole('button')
  const copyButton = buttons.find(button => button.textContent?.trim() === '' && button.querySelector('svg'))
  if (!copyButton)
    throw new Error('Copy button not found')
  return copyButton
}

// ============================================================================
// Tests
// ============================================================================

describe('VibePanel', () => {
  let toastNotifySpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseVibeFlowData.mockReturnValue(createVibeFlowData())
    toastNotifySpy = vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
  })

  afterEach(() => {
    toastNotifySpy.mockRestore()
  })

  // --------------------------------------------------------------------------
  // Rendering: default visibility and primary view states.
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render nothing when panel is hidden', () => {
      renderVibePanel({ workflowState: { showVibePanel: false } })

      expect(screen.queryByText(/app\.gotoAnything\.actions\.vibeTitle/i)).not.toBeInTheDocument()
    })

    it('should render placeholder when no preview data and not generating', () => {
      renderVibePanel({
        workflowState: { showVibePanel: true, isVibeGenerating: false },
        vibeFlowData: createVibeFlowData({ current: undefined }),
      })

      expect(screen.getByText(/appDebug\.generate\.newNoDataLine1/i)).toBeInTheDocument()
    })

    it('should render loading state when generating', () => {
      renderVibePanel({
        workflowState: { showVibePanel: true, isVibeGenerating: true },
      })

      expect(screen.getByText(/workflow\.vibe\.generatingFlowchart/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'appDebug.generate.generate' })).toBeDisabled()
    })

    it('should render preview panel when nodes exist', () => {
      const flowGraph = createFlowGraph({
        nodes: [createMockNode()],
        edges: [createMockEdge()],
      })

      renderVibePanel({
        vibeFlowData: createVibeFlowData({
          current: flowGraph,
          versions: [flowGraph],
        }),
      })

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'workflow.vibe.apply' })).toBeInTheDocument()
      expect(screen.getByText(/appDebug\.generate\.version/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props: store-driven inputs that toggle behavior.
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should render modal content when showVibePanel is true', () => {
      renderVibePanel({ workflowState: { showVibePanel: true } })

      expect(screen.getByText(/app\.gotoAnything\.actions\.vibeTitle/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions: input edits and action triggers.
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should update instruction in store when typing', async () => {
      const { workflowStore } = renderVibePanel()

      const textarea = screen.getByPlaceholderText('workflow.vibe.missingInstruction')
      fireEvent.change(textarea, { target: { value: 'Build a vibe flow' } })

      await waitFor(() => {
        expect(workflowStore.getState().vibePanelInstruction).toBe('Build a vibe flow')
      })
    })

    it('should dispatch command event with instruction when generate clicked', async () => {
      const user = userEvent.setup()
      const { workflowStore } = renderVibePanel({
        workflowState: { vibePanelInstruction: 'Generate a workflow' },
      })

      const handler = vi.fn()
      document.addEventListener(VIBE_COMMAND_EVENT, handler)

      await user.click(screen.getByRole('button', { name: 'appDebug.generate.generate' }))

      expect(handler).toHaveBeenCalledTimes(1)
      const event = handler.mock.calls[0][0] as CustomEvent<{ dsl?: string }>
      expect(event.detail).toEqual({ dsl: workflowStore.getState().vibePanelInstruction })

      document.removeEventListener(VIBE_COMMAND_EVENT, handler)
    })

    it('should close panel when dismiss clicked', async () => {
      const user = userEvent.setup()
      const { workflowStore } = renderVibePanel({
        workflowState: {
          vibePanelMermaidCode: 'graph TD',
          isVibeGenerating: true,
        },
      })

      await user.click(screen.getByRole('button', { name: 'appDebug.generate.dismiss' }))

      const state = workflowStore.getState()
      expect(state.showVibePanel).toBe(false)
      expect(state.vibePanelMermaidCode).toBe('')
      expect(state.isVibeGenerating).toBe(false)
    })

    it('should dispatch apply event and close panel when apply clicked', async () => {
      const user = userEvent.setup()
      const flowGraph = createFlowGraph({
        nodes: [createMockNode()],
        edges: [createMockEdge()],
      })
      const { workflowStore } = renderVibePanel({
        workflowState: { vibePanelMermaidCode: 'graph TD' },
        vibeFlowData: createVibeFlowData({
          current: flowGraph,
          versions: [flowGraph],
        }),
      })

      const handler = vi.fn()
      document.addEventListener(VIBE_APPLY_EVENT, handler)

      await user.click(screen.getByRole('button', { name: 'workflow.vibe.apply' }))

      expect(handler).toHaveBeenCalledTimes(1)
      const state = workflowStore.getState()
      expect(state.showVibePanel).toBe(false)
      expect(state.vibePanelMermaidCode).toBe('')
      expect(state.isVibeGenerating).toBe(false)

      document.removeEventListener(VIBE_APPLY_EVENT, handler)
    })

    it('should copy mermaid and notify when copy clicked', async () => {
      const user = userEvent.setup()
      const flowGraph = createFlowGraph({
        nodes: [createMockNode()],
        edges: [createMockEdge()],
      })

      renderVibePanel({
        workflowState: { vibePanelMermaidCode: 'graph TD' },
        vibeFlowData: createVibeFlowData({
          current: flowGraph,
          versions: [flowGraph],
        }),
      })

      await user.click(getCopyButton())

      expect(mockCopy).toHaveBeenCalledWith('graph TD')
      expect(toastNotifySpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        message: 'common.actionMsg.copySuccessfully',
      }))
    })
  })
})
