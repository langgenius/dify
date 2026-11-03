import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../../__tests__/workflow-test-env'
import ZoomInOut from '../zoom-in-out'

const renderZoom = (zoom = 1) =>
  renderWorkflowFlowComponent(<ZoomInOut />, {
    nodes: [
      createNode({ id: 'left', position: { x: 0, y: 0 }, width: 240, height: 80 }),
      createNode({ id: 'right', position: { x: 1600, y: 400 }, width: 240, height: 80 }),
    ],
    reactFlowProps: {
      fitView: false,
      minZoom: 0.25,
      maxZoom: 2,
      defaultViewport: { x: 0, y: 0, zoom },
    },
  })

const zoomLabel = () => screen.getByRole('button', { name: /^\d+%$/ })
const openZoomMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(zoomLabel())
  return within(await screen.findByRole('menu'))
}

describe('workflow preview zoom controls', () => {
  it('zooms out and in and displays the resulting viewport scale', async () => {
    const user = userEvent.setup()
    renderZoom()

    await user.click(screen.getByRole('button', { name: 'workflow.operator.zoomOut' }))
    await waitFor(() => expect(zoomLabel()).toHaveAccessibleName('83%'))
    await user.click(screen.getByRole('button', { name: 'workflow.operator.zoomIn' }))
    await waitFor(() => expect(zoomLabel()).toHaveAccessibleName('100%'))
  })

  it.each([
    { zoom: 0.25, control: 'workflow.operator.zoomOut', label: '25%' },
    { zoom: 2, control: 'workflow.operator.zoomIn', label: '200%' },
  ])('disables $control at $label', async ({ zoom, control, label }) => {
    const user = userEvent.setup()
    renderZoom(zoom)
    const button = screen.getByRole('button', { name: control })

    expect(button).toBeDisabled()
    await user.click(button)
    expect(zoomLabel()).toHaveAccessibleName(label)
  })

  it.each(['25%', '50%', '75%', '100%', '200%'])(
    'applies the %s preset from a click',
    async (label) => {
      const user = userEvent.setup()
      renderZoom(label === '100%' ? 0.75 : 1)
      const menu = await openZoomMenu(user)

      await user.click(menu.getByRole('menuitem', { name: new RegExp(`^${label}`) }))

      await waitFor(() => expect(zoomLabel()).toHaveAccessibleName(label))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    },
  )

  it('fits the graph from the menu', async () => {
    const user = userEvent.setup()
    renderZoom()
    const menu = await openZoomMenu(user)

    await user.click(menu.getByRole('menuitem', { name: /^workflow\.operator\.zoomToFit/ }))

    await waitFor(() => expect(zoomLabel()).toHaveAccessibleName('25%'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
