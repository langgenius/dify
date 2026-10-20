import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ZoomInOut from '../zoom-in-out'

const { mockZoomIn, mockZoomOut, mockZoomTo, mockFitView, mockViewport } = vi.hoisted(() => ({
  mockZoomIn: vi.fn(),
  mockZoomOut: vi.fn(),
  mockZoomTo: vi.fn(),
  mockFitView: vi.fn(),
  mockViewport: { zoom: 1 },
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    zoomTo: mockZoomTo,
    fitView: mockFitView,
  }),
  useViewport: () => mockViewport,
}))

const getZoomControls = () => ({
  zoomOutTrigger: screen.getByRole('button', { name: 'workflow.operator.zoomOut' }),
  label: screen.getByRole('button', { name: /^\d+%$/ }),
  zoomInTrigger: screen.getByRole('button', { name: 'workflow.operator.zoomIn' }),
})

const openZoomMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(getZoomControls().label)
  return within(await screen.findByRole('menu'))
}

describe('workflow preview zoom controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockViewport.zoom = 1
  })

  // The inline controls should call the reactflow zoom handlers when the viewport is within range.
  describe('Inline Controls', () => {
    it('should zoom out and zoom in when the viewport is within the supported range', async () => {
      const user = userEvent.setup()
      render(<ZoomInOut />)

      const { zoomOutTrigger, zoomInTrigger } = getZoomControls()

      await user.click(zoomOutTrigger)
      await user.click(zoomInTrigger)

      expect(mockZoomOut).toHaveBeenCalledTimes(1)
      expect(mockZoomIn).toHaveBeenCalledTimes(1)
    })

    it('should block zooming out when the viewport is already at the minimum scale', async () => {
      const user = userEvent.setup()
      mockViewport.zoom = 0.25
      render(<ZoomInOut />)

      await user.click(getZoomControls().zoomOutTrigger)

      expect(mockZoomOut).not.toHaveBeenCalled()
    })

    it('should block zooming in when the viewport is already at the maximum scale', async () => {
      const user = userEvent.setup()
      mockViewport.zoom = 2
      render(<ZoomInOut />)

      await user.click(getZoomControls().zoomInTrigger)

      expect(mockZoomIn).not.toHaveBeenCalled()
    })
  })

  // Preset menu actions should route to the correct reactflow commands.
  describe('Preset Menu', () => {
    it.each([
      ['25%', 0.25],
      ['50%', 0.5],
      ['75%', 0.75],
      ['100%', 1],
      ['200%', 2],
    ])('should zoom to %s when selecting that preset', async (label, zoom) => {
      const user = userEvent.setup()
      render(<ZoomInOut />)

      const portal = await openZoomMenu(user)

      await user.click(portal.getByRole('menuitem', { name: new RegExp(label) }))

      expect(mockZoomTo).toHaveBeenCalledWith(zoom)
      expect(mockFitView).not.toHaveBeenCalled()
    })

    it('should fit the viewport when selecting the fit option', async () => {
      const user = userEvent.setup()
      render(<ZoomInOut />)

      const portal = await openZoomMenu(user)

      await user.click(portal.getByRole('menuitem', { name: /workflow\.operator\.zoomToFit/ }))

      expect(mockFitView).toHaveBeenCalledTimes(1)
      expect(mockZoomTo).not.toHaveBeenCalled()
    })
  })
})
