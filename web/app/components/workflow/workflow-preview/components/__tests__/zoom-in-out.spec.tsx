import { fireEvent, render, screen, within } from '@testing-library/react'
import ZoomInOut from '../zoom-in-out'

const {
  mockZoomIn,
  mockZoomOut,
  mockZoomTo,
  mockFitView,
  mockViewport,
} = vi.hoisted(() => ({
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

describe('workflow preview zoom controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockViewport.zoom = 1
  })

  // The inline controls should call the reactflow zoom handlers when the viewport is within range.
  describe('Inline Controls', () => {
    it('should zoom out and zoom in when the viewport is within the supported range', () => {
      render(<ZoomInOut />)

      const { zoomOutTrigger, zoomInTrigger } = getZoomControls()

      fireEvent.click(zoomOutTrigger)
      fireEvent.click(zoomInTrigger)

      expect(mockZoomOut).toHaveBeenCalledTimes(1)
      expect(mockZoomIn).toHaveBeenCalledTimes(1)
    })

    it('should block zooming out when the viewport is already at the minimum scale', () => {
      mockViewport.zoom = 0.25
      render(<ZoomInOut />)

      fireEvent.click(getZoomControls().zoomOutTrigger)

      expect(mockZoomOut).not.toHaveBeenCalled()
    })

    it('should block zooming in when the viewport is already at the maximum scale', () => {
      mockViewport.zoom = 2
      render(<ZoomInOut />)

      fireEvent.click(getZoomControls().zoomInTrigger)

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
    ])('should zoom to %s when selecting that preset', (label, zoom) => {
      render(<ZoomInOut />)

      const portal = openZoomMenu()

      fireEvent.click(portal.getByText(label))

      expect(mockZoomTo).toHaveBeenCalledWith(zoom)
      expect(mockFitView).not.toHaveBeenCalled()
    })

    it('should fit the viewport when selecting the fit option', () => {
      render(<ZoomInOut />)

      const portal = openZoomMenu()

      fireEvent.click(portal.getByText('workflow.operator.zoomToFit'))

      expect(mockFitView).toHaveBeenCalledTimes(1)
      expect(mockZoomTo).not.toHaveBeenCalled()
    })
  })
})
