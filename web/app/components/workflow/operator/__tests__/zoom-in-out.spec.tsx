import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
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

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    zoomTo: mockZoomTo,
    fitView: mockFitView,
  }),
  useViewport: () => mockViewport,
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
  useWorkflowReadOnly: () => ({
    workflowReadOnly,
    getWorkflowReadOnly: () => workflowReadOnly,
  }),
}))

vi.mock('../tip-popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const renderZoomInOut = (ui: React.ReactElement = <ZoomInOut />) =>
  renderWithSystemFeatures(ui, {
    systemFeatures: { enable_collaboration_mode: collaborationEnabled },
  })

const getZoomControls = () => {
  const label = Array.from(document.querySelectorAll('button')).find((element) => {
    return /^\d+%$/.test(element.textContent ?? '') && element.className.includes('w-[34px]')
  })
  const zoomOutIcon = document.querySelector('.i-ri-zoom-out-line')
  const zoomInIcon = document.querySelector('.i-ri-zoom-in-line')

  if (!label || !zoomOutIcon || !zoomInIcon)
    throw new Error('Missing zoom controls')

  return {
    zoomOutTrigger: zoomOutIcon.parentElement as HTMLElement,
    label,
    zoomInTrigger: zoomInIcon.parentElement as HTMLElement,
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

  it('keeps the show-user-comments action disabled in comment mode', () => {
    renderZoomInOut(
      <ZoomInOut
        isCommentMode
        onToggleUserComments={mockToggleUserComments}
      />,
    )

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
