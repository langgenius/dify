import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect, useState } from 'react'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { WorkflowContext } from '../../context'
import { createWorkflowStore } from '../../store'
import ZoomInOut from '../zoom-in-out'

const {
  mockZoomIn,
  mockZoomOut,
  mockZoomTo,
  mockFitView,
  mockViewport,
  mockHandleSyncWorkflowDraft,
  mockToggleMiniMap,
  mockToggleUserComments,
  mockToggleUserCursors,
  mockInterrupt,
} = vi.hoisted(() => ({
  mockZoomIn: vi.fn(),
  mockZoomOut: vi.fn(),
  mockZoomTo: vi.fn(),
  mockFitView: vi.fn(),
  mockViewport: { zoom: 1 },
  mockHandleSyncWorkflowDraft: vi.fn(),
  mockToggleMiniMap: vi.fn(),
  mockToggleUserComments: vi.fn(),
  mockToggleUserCursors: vi.fn(),
  mockInterrupt: vi.fn(),
}))

let workflowReadOnly = false
let collaborationEnabled = true

vi.mock('reactflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('reactflow')>()
  return {
    ...actual,
    useReactFlow: () => ({
      zoomIn: mockZoomIn,
      zoomOut: mockZoomOut,
      zoomTo: mockZoomTo,
      fitView: mockFitView,
    }),
    useStoreApi: () => {
      const store = actual.useStoreApi()
      return {
        ...store,
        getState: () => ({ ...store.getState(), d3Selection: { interrupt: mockInterrupt } }),
      }
    },
  }
})

vi.mock('../../hooks/use-nodes-sync-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-sync-draft')>()

  return {
    ...actual,
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
    }),
  }
})

vi.mock('../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-workflow')>()

  return {
    ...actual,
    useWorkflowReadOnly: () => ({
      workflowReadOnly,
      getWorkflowReadOnly: () => workflowReadOnly,
    }),
  }
})

vi.mock('../tip-popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const InitialViewport = ({ zoom }: { zoom: number }) => {
  const store = useStoreApi()
  useLayoutEffect(() => {
    store.setState({ transform: [0, 0, zoom] })
  }, [store, zoom])
  return null
}

const renderZoomInOut = (ui: React.ReactElement = <ZoomInOut />, builderActive = false) => {
  const store = createWorkflowStore({})
  if (builderActive) store.setState({ canvasReadOnly: true, workflowDraftSyncPhase: 'builder' })
  const rendered = renderWithConsoleQuery(
    <WorkflowContext value={store}>
      <ReactFlowProvider>
        <InitialViewport zoom={mockViewport.zoom} />
        {ui}
      </ReactFlowProvider>
    </WorkflowContext>,
    { systemFeatures: { enable_collaboration_mode: collaborationEnabled } },
  )
  return { ...rendered, store }
}

const getZoomControls = () => {
  return {
    zoomOutTrigger: screen.getByRole('button', { name: 'workflow.operator.zoomOut' }),
    label: screen.getByRole('button', { name: /^\d+%$/ }),
    zoomInTrigger: screen.getByRole('button', { name: 'workflow.operator.zoomIn' }),
  }
}

const openZoomMenu = () => {
  fireEvent.click(getZoomControls().label)
  return within(screen.getByRole('menu'))
}

describe('workflow zoom controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockViewport.zoom = 1
    workflowReadOnly = false
    collaborationEnabled = true
  })

  it.each([
    { key: '1', modifier: 'Mod', zoom: undefined },
    { key: '1', modifier: 'Shift', zoom: 1 },
    { key: '5', modifier: 'Shift', zoom: 0.5 },
  ])('applies $modifier+$key from the focused zoom menu', async ({ key, modifier, zoom }) => {
    const user = userEvent.setup()
    renderZoomInOut()
    await user.click(screen.getByRole('button', { name: '100%' }))
    const item = screen.getByRole('menuitem', { name: '200%' })
    act(() => item.focus())
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    const heldKey = modifier === 'Mod' ? mod : modifier
    await user.keyboard(`{${heldKey}>}${key}{/${heldKey}}`)
    if (zoom === undefined) expect(mockFitView).toHaveBeenCalledTimes(1)
    else expect(mockZoomTo).toHaveBeenCalledExactlyOnceWith(zoom)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('zooms out and zooms in when the viewport is within the supported range', () => {
    renderZoomInOut()

    const { zoomOutTrigger, zoomInTrigger } = getZoomControls()

    fireEvent.click(zoomOutTrigger)
    fireEvent.click(zoomInTrigger)

    expect(mockZoomOut).toHaveBeenCalledTimes(1)
    expect(mockZoomIn).toHaveBeenCalledTimes(1)
  })

  it('zooms to a preset value and syncs the draft', () => {
    renderZoomInOut()

    const menu = openZoomMenu()
    fireEvent.click(menu.getByText('50%'))

    expect(mockZoomTo).toHaveBeenCalledWith(0.5)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['100%', 1],
    ['200%', 2],
  ])('zooms to %s and syncs the draft', (label, zoom) => {
    renderZoomInOut()

    const menu = openZoomMenu()
    fireEvent.click(menu.getByText(label))

    expect(mockZoomTo).toHaveBeenCalledWith(zoom)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('toggles collaboration options without syncing the draft', () => {
    renderZoomInOut(
      <ZoomInOut
        onToggleMiniMap={mockToggleMiniMap}
        onToggleUserComments={mockToggleUserComments}
        onToggleUserCursors={mockToggleUserCursors}
      />,
    )

    let menu = openZoomMenu()
    fireEvent.click(menu.getByText('workflow.operator.showMiniMap'))
    expect(mockToggleMiniMap).toHaveBeenCalledTimes(1)
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()

    menu = openZoomMenu()
    fireEvent.click(menu.getByText('workflow.operator.showUserComments'))
    expect(mockToggleUserComments).toHaveBeenCalledTimes(1)

    menu = openZoomMenu()
    fireEvent.click(menu.getByText('workflow.operator.showUserCursors'))
    expect(mockToggleUserCursors).toHaveBeenCalledTimes(1)
  })

  it('exposes display settings as checked menu items and updates them with the keyboard', async () => {
    const user = userEvent.setup()
    const DisplaySettings = () => {
      const [showMiniMap, setShowMiniMap] = useState(true)
      return (
        <ZoomInOut
          showMiniMap={showMiniMap}
          onToggleMiniMap={() => setShowMiniMap((value) => !value)}
          showUserCursors={false}
          showUserComments
        />
      )
    }
    renderZoomInOut(<DisplaySettings />)

    await user.click(screen.getByRole('button', { name: '100%' }))
    const miniMap = screen.getByRole('menuitemcheckbox', { name: 'workflow.operator.showMiniMap' })
    expect(miniMap).toBeChecked()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'workflow.operator.showUserCursors' }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'workflow.operator.showUserComments' }),
    ).toBeChecked()
    expect(screen.getByRole('menuitem', { name: '200%' })).toBeInTheDocument()

    miniMap.focus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: '100%' }))
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'workflow.operator.showMiniMap' }),
    ).not.toBeChecked()
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('keeps the show-user-comments action disabled in comment mode', () => {
    renderZoomInOut(<ZoomInOut isCommentMode onToggleUserComments={mockToggleUserComments} />)

    const menu = openZoomMenu()
    fireEvent.click(menu.getByText('workflow.operator.showUserComments'))

    expect(mockToggleUserComments).not.toHaveBeenCalled()
  })

  it('does not open the menu when the workflow is read only', () => {
    workflowReadOnly = true
    renderZoomInOut()

    fireEvent.click(getZoomControls().label)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('lets users zoom and fit the canvas while Builder owns its read-only graph', async () => {
    workflowReadOnly = true
    const user = userEvent.setup()
    const { store } = renderZoomInOut(<ZoomInOut />, true)

    await user.click(screen.getByRole('button', { name: '100%' }))
    await user.click(screen.getByRole('menuitem', { name: /^50%/ }))
    expect(mockZoomTo).toHaveBeenCalledWith(0.5)
    expect(store.getState().builderViewportManuallyChanged).toBe(true)
    expect(mockInterrupt).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '100%' }))
    await user.click(screen.getByRole('menuitem', { name: /zoomToFit/ }))
    expect(mockFitView).toHaveBeenCalledOnce()
    expect(store.getState().canvasReadOnly).toBe(true)
  })

  it('blocks inline zooming out at the minimum viewport scale', () => {
    mockViewport.zoom = 0.25
    renderZoomInOut()

    fireEvent.click(getZoomControls().zoomOutTrigger)
    expect(mockZoomOut).not.toHaveBeenCalled()
  })

  it('blocks inline zooming in at the maximum viewport scale', () => {
    mockViewport.zoom = 2
    renderZoomInOut()

    fireEvent.click(getZoomControls().zoomInTrigger)
    expect(mockZoomIn).not.toHaveBeenCalled()
  })

  it('updates its zoom label and limits when the viewport scale changes', async () => {
    const user = userEvent.setup()
    const ViewportControls = () => {
      const store = useStoreApi()
      return (
        <>
          <button type="button" onClick={() => store.setState({ transform: [80, 120, 0.25] })}>
            Set minimum zoom
          </button>
          <button type="button" onClick={() => store.setState({ transform: [80, 120, 2] })}>
            Set maximum zoom
          </button>
        </>
      )
    }
    renderZoomInOut(
      <>
        <ViewportControls />
        <ZoomInOut />
      </>,
    )

    expect(screen.getByRole('button', { name: '100%' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Set minimum zoom' }))
    expect(screen.getByRole('button', { name: '25%' })).toBeInTheDocument()
    expect(getZoomControls().zoomOutTrigger).toBeDisabled()
    expect(getZoomControls().zoomInTrigger).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Set maximum zoom' }))
    expect(screen.getByRole('button', { name: '200%' })).toBeInTheDocument()
    expect(getZoomControls().zoomInTrigger).toBeDisabled()
    expect(getZoomControls().zoomOutTrigger).toBeEnabled()
  })

  it('renders collaboration menu entries only when collaboration is enabled', () => {
    collaborationEnabled = false
    renderZoomInOut()

    const menu = openZoomMenu()
    expect(menu.getByText('workflow.operator.showMiniMap')).toBeInTheDocument()
    expect(menu.queryByText('workflow.operator.showUserComments')).not.toBeInTheDocument()
    expect(menu.queryByText('workflow.operator.showUserCursors')).not.toBeInTheDocument()
  })
})
