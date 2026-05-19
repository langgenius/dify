import type { Edge, Node } from '../types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { useNodes } from 'reactflow'
import SelectionContextmenu from '../selection-contextmenu'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import { createEdge, createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

let latestNodes: Node[] = []
let latestHistoryEvent: string | undefined
const mockGetNodesReadOnly = vi.fn()
const mockHandleNodesCopy = vi.fn()
const mockHandleNodesDelete = vi.fn()
const mockHandleNodesDuplicate = vi.fn()
const mockPush = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockCreateSnippetMutateAsync = vi.fn()
const mockSyncDraftWorkflow = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/service/use-snippets', () => ({
  useCreateSnippetMutation: () => ({
    mutateAsync: mockCreateSnippetMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  return {
    ...actual,
    consoleClient: {
      ...actual.consoleClient,
      snippets: {
        ...actual.consoleClient.snippets,
        syncDraftWorkflow: (...args: unknown[]) => mockSyncDraftWorkflow(...args),
      },
    },
  }
})

vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodesCopy: mockHandleNodesCopy,
      handleNodesDelete: mockHandleNodesDelete,
      handleNodesDuplicate: mockHandleNodesDuplicate,
    }),
    useNodesReadOnly: () => ({
      getNodesReadOnly: mockGetNodesReadOnly,
    }),
  }
})

const RuntimeProbe = () => {
  latestNodes = useNodes() as Node[]
  const { store } = useWorkflowHistoryStore()

  useEffect(() => {
    latestHistoryEvent = store.getState().workflowHistoryEvent
    return store.subscribe((state) => {
      latestHistoryEvent = state.workflowHistoryEvent
    })
  }, [store])

  return null
}

const hooksStoreProps = {
  doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
}

const renderSelectionMenu = (options?: {
  nodes?: Node[]
  edges?: Edge[]
  initialStoreState?: Record<string, unknown>
}) => {
  latestNodes = []
  latestHistoryEvent = undefined

  const nodes = options?.nodes ?? []
  const edges = options?.edges ?? []

  return renderWorkflowFlowComponent(
    <div id="workflow-container" style={{ width: 800, height: 600 }}>
      <RuntimeProbe />
      <SelectionContextmenu />
    </div>,
    {
      nodes,
      edges,
      hooksStoreProps,
      historyStore: { nodes, edges },
      initialStoreState: options?.initialStoreState,
      reactFlowProps: { fitView: false },
    },
  )
}

describe('SelectionContextmenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestNodes = []
    latestHistoryEvent = undefined
    mockGetNodesReadOnly.mockReset()
    mockGetNodesReadOnly.mockReturnValue(false)
    mockHandleNodesCopy.mockReset()
    mockHandleNodesDelete.mockReset()
    mockHandleNodesDuplicate.mockReset()
    mockPush.mockReset()
    mockToastSuccess.mockReset()
    mockToastError.mockReset()
    mockCreateSnippetMutateAsync.mockReset()
    mockSyncDraftWorkflow.mockReset()
  })

  it('should not render when selectionMenu is absent', () => {
    renderSelectionMenu()

    expect(screen.queryByText('operator.vertical')).not.toBeInTheDocument()
  })

  it('should render menu items when selectionMenu is present', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
    ]
    const { store } = renderSelectionMenu({ nodes })
    const container = document.querySelector('#workflow-container') as HTMLDivElement

    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 16,
      y: 24,
      left: 16,
      top: 24,
      right: 816,
      bottom: 624,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })

    act(() => {
      store.setState({ selectionMenu: { clientX: 780, clientY: 590 } })
    })

    await waitFor(() => {
      expect(screen.getByTestId('selection-contextmenu-item-left')).toBeInTheDocument()
    })
  })

  it('should render and execute copy/duplicate/delete operations', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
    ]
    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { clientX: 120, clientY: 120 } })
    })

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /common.copy/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /common.copy/ }))
    expect(mockHandleNodesCopy).toHaveBeenCalledTimes(1)
    expect(store.getState().selectionMenu).toBeUndefined()

    act(() => {
      store.setState({ selectionMenu: { clientX: 120, clientY: 120 } })
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /common.duplicate/ }))
    expect(mockHandleNodesDuplicate).toHaveBeenCalledTimes(1)
    expect(store.getState().selectionMenu).toBeUndefined()

    act(() => {
      store.setState({ selectionMenu: { clientX: 120, clientY: 120 } })
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /operation.delete/ }))
    expect(mockHandleNodesDelete).toHaveBeenCalledTimes(1)
    expect(store.getState().selectionMenu).toBeUndefined()
  })

  it('should close itself when only one node is selected', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { clientX: 120, clientY: 120 } })
    })

    await waitFor(() => {
      expect(store.getState().selectionMenu).toBeUndefined()
    })
  })

  it('should align selected nodes to the left and save history', async () => {
    vi.useFakeTimers()
    const nodes = [
      createNode({ id: 'n1', selected: true, position: { x: 20, y: 40 }, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 90 }, width: 60, height: 30 }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
      edges: [createEdge({ source: 'n1', target: 'n2' })],
      initialStoreState: {
        helpLineHorizontal: { y: 10 } as never,
        helpLineVertical: { x: 10 } as never,
      },
    })

    act(() => {
      store.setState({ selectionMenu: { clientX: 100, clientY: 100 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(latestNodes.find(node => node.id === 'n1')?.position.x).toBe(20)
    expect(latestNodes.find(node => node.id === 'n2')?.position.x).toBe(20)
    expect(store.getState().selectionMenu).toBeUndefined()
    expect(store.getState().helpLineHorizontal).toBeUndefined()
    expect(store.getState().helpLineVertical).toBeUndefined()

    act(() => {
      store.getState().flushPendingSync()
      vi.advanceTimersByTime(600)
    })

    expect(hooksStoreProps.doSyncWorkflowDraft).toHaveBeenCalled()
    expect(latestHistoryEvent).toBe('NodeDragStop')
    vi.useRealTimers()
  })

  it('should render selection actions and delegate copy, duplicate, and delete', () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 }, width: 40, height: 20 }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { clientX: 120, clientY: 120 } })
    })

    expect(screen.getByTestId('selection-contextmenu-item-copy')).toHaveTextContent('workflow.common.copy')
    expect(screen.getByTestId('selection-contextmenu-item-duplicate')).toHaveTextContent('workflow.common.duplicate')
    expect(screen.getByTestId('selection-contextmenu-item-delete')).toHaveTextContent('common.operation.delete')

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-copy'))

    act(() => {
      store.setState({ selectionMenu: { clientX: 120, clientY: 120 } })
    })
    fireEvent.click(screen.getByTestId('selection-contextmenu-item-duplicate'))

    act(() => {
      store.setState({ selectionMenu: { clientX: 120, clientY: 120 } })
    })
    fireEvent.click(screen.getByTestId('selection-contextmenu-item-delete'))

    expect(mockHandleNodesCopy).toHaveBeenCalledTimes(1)
    expect(mockHandleNodesDuplicate).toHaveBeenCalledTimes(1)
    expect(mockHandleNodesDelete).toHaveBeenCalledTimes(1)
  })

  it('should create a snippet with the selected graph and redirect to the snippet detail page', async () => {
    mockCreateSnippetMutateAsync.mockResolvedValue({ id: 'snippet-123' })
    mockSyncDraftWorkflow.mockResolvedValue({ result: 'success' })

    const nodes = [
      createNode({ id: 'n1', selected: true, position: { x: 120, y: 60 }, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 260, y: 120 }, width: 60, height: 30 }),
      createNode({ id: 'n3', selected: false, position: { x: 500, y: 300 }, width: 40, height: 20 }),
    ]
    const edges = [
      createEdge({ id: 'e1', source: 'n1', target: 'n2' }),
      createEdge({ id: 'e2', source: 'n2', target: 'n3' }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
      edges,
      initialStoreState: {
        workflowCanvasWidth: 800,
        workflowCanvasHeight: 600,
      },
    })

    act(() => {
      store.setState({ selectionMenu: { clientX: 120, clientY: 120 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-createSnippet'))
    expect(store.getState().selectionMenu).toBeUndefined()
    expect(screen.queryByTestId('selection-contextmenu-item-createSnippet')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
      target: { value: 'My snippet' },
    })
    fireEvent.click(screen.getByRole('button', { name: /workflow\.snippet\.confirm/i }))

    await waitFor(() => {
      expect(mockCreateSnippetMutateAsync).toHaveBeenCalledWith({
        body: expect.objectContaining({
          name: 'My snippet',
        }),
      })
    })

    expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
      params: { snippetId: 'snippet-123' },
      body: {
        graph: {
          nodes: [
            expect.objectContaining({
              id: 'n1',
              position: { x: 0, y: 0 },
              selected: false,
              data: expect.objectContaining({ selected: false }),
            }),
            expect.objectContaining({
              id: 'n2',
              position: { x: 140, y: 60 },
              selected: false,
              data: expect.objectContaining({ selected: false }),
            }),
          ],
          edges: [
            expect.objectContaining({
              id: 'e1',
              source: 'n1',
              target: 'n2',
              selected: false,
            }),
          ],
          viewport: { x: 300, y: 255, zoom: 1 },
        },
      },
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('workflow.snippet.createSuccess')
    expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-123/orchestrate')
  })

  it('should distribute selected nodes horizontally', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, position: { x: 0, y: 10 }, width: 20, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 100, y: 20 }, width: 20, height: 20 }),
      createNode({ id: 'n3', selected: true, position: { x: 300, y: 30 }, width: 20, height: 20 }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
    })

    act(() => {
      store.setState({ selectionMenu: { clientX: 160, clientY: 120 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-distributeHorizontal'))

    expect(latestNodes.find(node => node.id === 'n2')?.position.x).toBe(150)
  })

  it('should ignore child nodes when the selected container is aligned', async () => {
    const nodes = [
      createNode({
        id: 'container',
        selected: true,
        position: { x: 200, y: 0 },
        width: 100,
        height: 80,
        data: { _children: [{ nodeId: 'child', nodeType: 'code' as never }] },
      }),
      createNode({
        id: 'child',
        selected: true,
        position: { x: 210, y: 10 },
        width: 30,
        height: 20,
      }),
      createNode({
        id: 'other',
        selected: true,
        position: { x: 40, y: 60 },
        width: 40,
        height: 20,
      }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
    })

    act(() => {
      store.setState({ selectionMenu: { clientX: 180, clientY: 120 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(latestNodes.find(node => node.id === 'container')?.position.x).toBe(40)
    expect(latestNodes.find(node => node.id === 'other')?.position.x).toBe(40)
    expect(latestNodes.find(node => node.id === 'child')?.position.x).toBe(210)
  })

  it('should cancel when align bounds cannot be resolved', () => {
    const nodes = [
      createNode({ id: 'n1', selected: true }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 } }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { clientX: 100, clientY: 100 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(store.getState().selectionMenu).toBeUndefined()
  })

  it('should cancel without aligning when nodes are read only', () => {
    mockGetNodesReadOnly.mockReturnValue(true)
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 }, width: 40, height: 20 }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { clientX: 100, clientY: 100 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(store.getState().selectionMenu).toBeUndefined()
    expect(latestNodes.find(node => node.id === 'n1')?.position.x).toBe(0)
    expect(latestNodes.find(node => node.id === 'n2')?.position.x).toBe(80)
  })

  it('should cancel when alignable nodes shrink to one item', () => {
    const nodes = [
      createNode({
        id: 'container',
        selected: true,
        width: 40,
        height: 20,
        data: { _children: [{ nodeId: 'child', nodeType: 'code' as never }] },
      }),
      createNode({ id: 'child', selected: true, position: { x: 80, y: 20 }, width: 40, height: 20 }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ selectionMenu: { clientX: 100, clientY: 100 } })
    })

    fireEvent.click(screen.getByTestId('selection-contextmenu-item-left'))

    expect(store.getState().selectionMenu).toBeUndefined()
    expect(latestNodes.find(node => node.id === 'container')?.position.x).toBe(0)
    expect(latestNodes.find(node => node.id === 'child')?.position.x).toBe(80)
  })
})
