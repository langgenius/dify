import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect, useState } from 'react'
import { useStoreApi } from 'reactflow'
import { renderWorkflowFlowComponent as renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
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
}))

let workflowReadOnly = false
let collaborationEnabled = true

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useReactFlow: () => ({
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    zoomTo: mockZoomTo,
    fitView: mockFitView,
  }),
}))

vi.mock('../../hooks/use-nodes-sync-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-sync-draft')>()

  return {
    ...actual,
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
    }),
  }
})

function ViewportSeed({ children }: { children: React.ReactNode }) {
  const store = useStoreApi()
  useLayoutEffect(() => {
    store.setState({ transform: [0, 0, mockViewport.zoom] })
  })
  return children
}

const renderZoomInOut = (ui: React.ReactElement = <ZoomInOut />) => {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: collaborationEnabled },
  })
  const rendered = renderWorkflowComponent(<ViewportSeed>{ui}</ViewportSeed>, {
    queryClient,
    initialStoreState: { canvasReadOnly: workflowReadOnly },
    reactFlowProps: {
      fitView: false,
      minZoom: 0.25,
      defaultViewport: { x: 0, y: 0, zoom: mockViewport.zoom },
    },
  })
  return {
    ...rendered,
    rerender: (nextUI: React.ReactElement) =>
      rendered.rerender(<ViewportSeed>{nextUI}</ViewportSeed>),
  }
}

const getZoomControls = () => ({
  label: screen.getByRole('button', { name: /^\d+%$/ }),
  zoomOutTrigger: screen.getByRole('button', { name: 'workflow.operator.zoomOut' }),
  zoomInTrigger: screen.getByRole('button', { name: 'workflow.operator.zoomIn' }),
})

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

  it('allows zooming and fitting the canvas while Builder owns its graph', async () => {
    const user = userEvent.setup()
    const { store } = renderZoomInOut()
    act(() => store.getState().setWorkflowDraftSyncPhase('builder'))
    await user.click(getZoomControls().zoomInTrigger)
    await user.click(getZoomControls().zoomOutTrigger)
    await user.click(getZoomControls().label)
    await user.click(screen.getByRole('menuitem', { name: /workflow.operator.zoomToFit/ }))
    expect(mockZoomIn).toHaveBeenCalledOnce()
    expect(mockZoomOut).toHaveBeenCalledOnce()
    expect(mockFitView).toHaveBeenCalledOnce()
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledOnce()
  })

  it('updates the zoom label and limits when the viewport scale changes', () => {
    const { rerender } = renderZoomInOut()
    mockViewport.zoom = 0.25
    rerender(<ZoomInOut />)
    expect(getZoomControls().label).toHaveAccessibleName('25%')
    expect(getZoomControls().zoomOutTrigger).toBeDisabled()
    mockViewport.zoom = 2
    rerender(<ZoomInOut />)
    expect(getZoomControls().label).toHaveAccessibleName('200%')
    expect(getZoomControls().zoomInTrigger).toBeDisabled()
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

  it('keeps viewport navigation available when the canvas is read only', () => {
    workflowReadOnly = true
    renderZoomInOut()

    fireEvent.click(getZoomControls().label)

    expect(screen.getByRole('menu')).toBeInTheDocument()
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

  it('renders collaboration menu entries only when collaboration is enabled', () => {
    collaborationEnabled = false
    renderZoomInOut()

    const menu = openZoomMenu()
    expect(menu.getByText('workflow.operator.showMiniMap')).toBeInTheDocument()
    expect(menu.queryByText('workflow.operator.showUserComments')).not.toBeInTheDocument()
    expect(menu.queryByText('workflow.operator.showUserCursors')).not.toBeInTheDocument()
  })
})
