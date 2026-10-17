import type { ReactNode } from 'react'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWorkflowSlice } from '@/app/components/workflow-app/store/workflow/workflow-slice'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '../node-handle'

type MockHooksState = {
  availablePrevBlocks: BlockEnum[]
  availableNextBlocks: BlockEnum[]
  isChatflow: boolean
  isReadOnly: boolean
}

const { mockHandleNodeAdd, mockHooksState } = vi.hoisted(() => ({
  mockHandleNodeAdd: vi.fn(),
  mockHooksState: {
    availablePrevBlocks: [],
    availableNextBlocks: [],
    isChatflow: false,
    isReadOnly: false,
  } as MockHooksState,
}))
let autoOpen = false
const render = (
  ui: React.ReactElement,
  options: Parameters<typeof renderWorkflowFlowComponent>[1] = {},
) =>
  renderWorkflowFlowComponent(ui, {
    ...options,
    initialStoreState: {
      shouldAutoOpenStartNodeSelector: autoOpen,
      canvasReadOnly: mockHooksState.isReadOnly,
    },
    hooksStoreProps: {
      accessControl: {
        canEdit: true,
        canRun: true,
        canImportExportDSL: true,
        canReleaseAndVersion: true,
      },
    },
  })

type HandleProps = {
  id?: string
  className?: string
  children?: ReactNode
  onClick?: () => void
}

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  Handle: ({ id, className, children, onClick }: HandleProps) => (
    <div
      data-testid={`handle-${id ?? 'unknown'}`}
      data-handleid={id}
      className={className}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick?.()
      }}
    >
      {children}
    </div>
  ),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

vi.mock('../../../../hooks/use-available-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-available-blocks')>()

  return {
    ...actual,
    useAvailableBlocks: () => ({
      availablePrevBlocks: mockHooksState.availablePrevBlocks,
      availableNextBlocks: mockHooksState.availableNextBlocks,
    }),
  }
})

vi.mock('../../../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodeAdd: mockHandleNodeAdd,
    }),
  }
})

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({ plugins: [], isLoading: false }),
  useFeaturedTriggersRecommendations: () => ({ plugins: [], isLoading: false }),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
  useInvalidateAllTriggerPlugins: () => vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: () => ({ data: undefined }),
}))

const createNodeData = (overrides: Partial<CommonNodeType> = {}): CommonNodeType => ({
  type: BlockEnum.Code,
  title: 'Node',
  desc: '',
  selected: false,
  ...overrides,
})

const getAddNodeButton = () => screen.getByRole('button', { name: 'workflow.common.addBlock' })
const queryAddNodeButton = () => screen.queryByRole('button', { name: 'workflow.common.addBlock' })

const renderTargetHandle = (dataOverrides: Partial<CommonNodeType> = {}) => {
  return render(
    <NodeTargetHandle
      id="target-node"
      data={createNodeData(dataOverrides)}
      handleId="target-handle"
      nodeSelectorClassName="custom-selector"
      handleClassName="custom-target-handle"
    />,
    {
      injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: mockHooksState.isChatflow ? 'advanced-chat' : 'workflow',
      },
    },
  )
}

const renderSourceHandle = (
  dataOverrides: Partial<CommonNodeType> = {},
  propsOverrides: Partial<React.ComponentProps<typeof NodeSourceHandle>> = {},
) => {
  return render(
    <NodeSourceHandle
      id="source-node"
      data={createNodeData(dataOverrides)}
      handleId="source-handle"
      nodeSelectorClassName="custom-selector"
      handleClassName="custom-source-handle"
      {...propsOverrides}
    />,
    {
      injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
      resource: {
        kind: 'app',
        appId: 'app-1',
        mode: mockHooksState.isChatflow ? 'advanced-chat' : 'workflow',
      },
    },
  )
}

describe('node-handle', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockHooksState.availablePrevBlocks = [BlockEnum.Code]
    mockHooksState.availableNextBlocks = [BlockEnum.Code]
    mockHooksState.isChatflow = false
    mockHooksState.isReadOnly = false

    autoOpen = false
  })

  // Target-side tests cover selector visibility, connection locking, and status rendering.
  describe('NodeTargetHandle', () => {
    it('should show the start tab when adding a node before the target node', async () => {
      const user = userEvent.setup()

      renderTargetHandle()

      await user.click(screen.getByTestId('handle-target-handle'))

      expect(screen.getByRole('tab', { name: 'workflow.tabs.start' })).toBeInTheDocument()
    })

    it('opens and closes the target selector from its handle', async () => {
      const user = userEvent.setup()
      renderTargetHandle()
      const handle = screen.getByTestId('handle-target-handle')
      await user.click(handle)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('should not render the target add trigger when the handle is already connected', async () => {
      renderTargetHandle({
        _connectedTargetHandleIds: ['target-handle'],
      })

      await userEvent.setup().click(screen.getByTestId('handle-target-handle'))

      expect(queryAddNodeButton()).not.toBeInTheDocument()
    })
  })

  // Source-side tests cover selector opening paths, previous-node selection, and status styling.
  describe('NodeSourceHandle', () => {
    it('should show the start tab when adding a node after the source node', async () => {
      const user = userEvent.setup()

      renderSourceHandle()

      await user.click(screen.getByTestId('handle-source-handle'))

      expect(screen.getByRole('tab', { name: 'workflow.tabs.start' })).toBeInTheDocument()
    })

    it('opens and closes the source selector from its handle', async () => {
      const user = userEvent.setup()
      renderSourceHandle()
      const handle = screen.getByTestId('handle-source-handle')
      await user.click(handle)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  // Auto-open tests cover workflow start-trigger variants, chat-mode bypass, and store fallback paths.
  describe('NodeSourceHandle auto-open', () => {
    it('restores the previous focus when the start selector opens automatically', async () => {
      const user = userEvent.setup()
      render(<button type="button">Previous action</button>, {
        injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: mockHooksState.isChatflow ? 'advanced-chat' : 'workflow',
        },
      })
      const previousAction = screen.getByRole('button', { name: 'Previous action' })
      await user.click(previousAction)
      autoOpen = true

      renderSourceHandle({ type: BlockEnum.Start })
      await screen.findByRole('dialog')
      await user.keyboard('{Escape}')

      await waitFor(() => expect(previousAction).toHaveFocus())
    })

    it.each([
      BlockEnum.Start,
      BlockEnum.TriggerSchedule,
      BlockEnum.TriggerWebhook,
      BlockEnum.TriggerPlugin,
    ])('should auto-open immediately for %s nodes', (type) => {
      autoOpen = true

      const { store } = renderSourceHandle({ type })

      const addNodeButton = getAddNodeButton()

      expect(addNodeButton).toHaveAttribute('data-popup-open')
      expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(false)
      expect(store.getState().hasSelectedStartNode).toBe(false)
    })

    it('should skip source auto-open in chat mode and only reset the start selector flag', () => {
      mockHooksState.isChatflow = true
      autoOpen = true

      const { store } = renderSourceHandle({ type: BlockEnum.Start })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(false)
    })

    it('should not auto-open when the node type is not a workflow entry node', () => {
      autoOpen = true

      const { store } = renderSourceHandle({ type: BlockEnum.Code })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(true)
    })
  })
  it('does not offer insertion controls on a readonly canvas', async () => {
    mockHooksState.isReadOnly = true
    autoOpen = true
    renderSourceHandle({ type: BlockEnum.Start })
    await userEvent.setup().click(screen.getByTestId('handle-source-handle'))
    expect(queryAddNodeButton()).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockHandleNodeAdd).not.toHaveBeenCalled()
  })
})
