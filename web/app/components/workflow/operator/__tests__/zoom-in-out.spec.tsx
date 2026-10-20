import type { Shape as HooksStoreShape } from '../../hooks-store/store'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import ZoomInOut from '../zoom-in-out'

let workflowReadOnly = false
let collaborationEnabled = true

const renderZoomInOut = ({
  ui = <ZoomInOut />,
  initialZoom = 1,
}: {
  ui?: React.ReactElement
  initialZoom?: number
} = {}) => {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: collaborationEnabled },
  })
  const doSyncWorkflowDraft = vi
    .fn<HooksStoreShape['doSyncWorkflowDraft']>()
    .mockResolvedValue(undefined)
  const view = renderWorkflowFlowComponent(ui, {
    queryClient,
    nodes: [
      createNode({ id: 'left', position: { x: 0, y: 0 }, width: 240, height: 80 }),
      createNode({ id: 'right', position: { x: 1600, y: 400 }, width: 240, height: 80 }),
    ],
    initialStoreState: { canvasReadOnly: workflowReadOnly },
    hooksStoreProps: { doSyncWorkflowDraft },
    reactFlowProps: {
      fitView: false,
      minZoom: 0.25,
      maxZoom: 2,
      defaultViewport: { x: 0, y: 0, zoom: initialZoom },
    },
  })
  return { ...view, doSyncWorkflowDraft }
}

const getZoomControls = () => ({
  label: screen.getByRole('button', { name: /^\d+%$/ }),
  zoomOutTrigger: screen.getByRole('button', { name: 'workflow.operator.zoomOut' }),
  zoomInTrigger: screen.getByRole('button', { name: 'workflow.operator.zoomIn' }),
})

const openZoomMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(getZoomControls().label)
  return within(screen.getByRole('menu'))
}

describe('workflow zoom controls', () => {
  beforeEach(() => {
    workflowReadOnly = false
    collaborationEnabled = true
  })

  it.each([
    { key: '1', modifier: 'Shift', initialZoom: 0.75, expectedLabel: '100%' },
    { key: '5', modifier: 'Shift', initialZoom: 1, expectedLabel: '50%' },
  ])(
    'applies $modifier+$key from the focused zoom menu',
    async ({ key, modifier, initialZoom, expectedLabel }) => {
      const user = userEvent.setup()
      const { store, doSyncWorkflowDraft } = renderZoomInOut({ initialZoom })
      const menu = await openZoomMenu(user)
      const item = menu.getByRole('menuitem', { name: '200%' })
      act(() => item.focus())

      await user.keyboard(`{${modifier}>}${key}{/${modifier}}`)

      await waitFor(() => expect(getZoomControls().label).toHaveAccessibleName(expectedLabel))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      act(() => store.getState().flushPendingSync())
      expect(doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    },
  )

  it('fits the real graph from the existing menu shortcut', async () => {
    const user = userEvent.setup()
    const { store, doSyncWorkflowDraft } = renderZoomInOut()
    const menu = await openZoomMenu(user)
    act(() => menu.getByRole('menuitem', { name: '200%' }).focus())
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'

    await user.keyboard(`{${mod}>}1{/${mod}}`)

    await waitFor(() => expect(getZoomControls().label).toHaveAccessibleName('25%'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    act(() => store.getState().flushPendingSync())
    expect(doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('zooms out and in through the inline controls and reports the real viewport', async () => {
    const user = userEvent.setup()
    renderZoomInOut()

    await user.click(getZoomControls().zoomOutTrigger)
    await waitFor(() => expect(getZoomControls().label).toHaveAccessibleName('83%'))

    await user.click(getZoomControls().zoomInTrigger)
    await waitFor(() => expect(getZoomControls().label).toHaveAccessibleName('100%'))
  })

  it.each([
    { itemLabel: '50%', initialZoom: 1 },
    { itemLabel: '100%', initialZoom: 0.75 },
    { itemLabel: '200%', initialZoom: 1 },
  ])('zooms to the $itemLabel preset through its menu item', async ({ itemLabel, initialZoom }) => {
    const user = userEvent.setup()
    const { store, doSyncWorkflowDraft } = renderZoomInOut({ initialZoom })

    const menu = await openZoomMenu(user)
    await user.click(menu.getByRole('menuitem', { name: new RegExp(`^${itemLabel}`) }))

    await waitFor(() => expect(getZoomControls().label).toHaveAccessibleName(itemLabel))
    act(() => store.getState().flushPendingSync())
    expect(doSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('updates controlled collaboration settings without saving the graph', async () => {
    const user = userEvent.setup()
    const DisplaySettings = () => {
      const [showMiniMap, setShowMiniMap] = useState(true)
      const [showUserCursors, setShowUserCursors] = useState(false)
      const [showUserComments, setShowUserComments] = useState(true)
      return (
        <ZoomInOut
          showMiniMap={showMiniMap}
          onToggleMiniMap={() => setShowMiniMap((value) => !value)}
          showUserCursors={showUserCursors}
          onToggleUserCursors={() => setShowUserCursors((value) => !value)}
          showUserComments={showUserComments}
          onToggleUserComments={() => setShowUserComments((value) => !value)}
        />
      )
    }
    const { store, doSyncWorkflowDraft } = renderZoomInOut({ ui: <DisplaySettings /> })

    let menu = await openZoomMenu(user)
    expect(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showMiniMap' }),
    ).toBeChecked()
    expect(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showUserCursors' }),
    ).not.toBeChecked()
    expect(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showUserComments' }),
    ).toBeChecked()

    await user.click(menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showMiniMap' }))
    menu = await openZoomMenu(user)
    expect(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showMiniMap' }),
    ).not.toBeChecked()
    act(() => menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showMiniMap' }).focus())
    await user.keyboard('{Enter}')
    menu = await openZoomMenu(user)
    expect(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showMiniMap' }),
    ).toBeChecked()
    await user.click(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showUserCursors' }),
    )
    menu = await openZoomMenu(user)
    expect(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showUserCursors' }),
    ).toBeChecked()
    await user.click(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showUserComments' }),
    )
    menu = await openZoomMenu(user)
    expect(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showUserComments' }),
    ).not.toBeChecked()
    act(() => store.getState().flushPendingSync())
    expect(doSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('keeps the show-user-comments action disabled in comment mode', async () => {
    const user = userEvent.setup()
    const onToggleUserComments = vi.fn()
    renderZoomInOut({
      ui: <ZoomInOut isCommentMode onToggleUserComments={onToggleUserComments} />,
    })

    const menu = await openZoomMenu(user)
    const comments = menu.getByRole('menuitemcheckbox', {
      name: 'workflow.operator.showUserComments',
    })
    expect(comments).toHaveAttribute('aria-disabled', 'true')
    await user.click(comments)
    expect(onToggleUserComments).not.toHaveBeenCalled()
  })

  it('does not open the menu when the workflow is read only', async () => {
    const user = userEvent.setup()
    workflowReadOnly = true
    renderZoomInOut()

    expect(getZoomControls().label).toBeDisabled()
    await user.click(getZoomControls().label)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('disables inline zoom controls at the supported viewport bounds', async () => {
    const user = userEvent.setup()
    renderZoomInOut()

    let menu = await openZoomMenu(user)
    await user.click(menu.getByRole('menuitem', { name: '25%' }))
    await waitFor(() => expect(getZoomControls().zoomOutTrigger).toBeDisabled())

    menu = await openZoomMenu(user)
    await user.click(menu.getByRole('menuitem', { name: '200%' }))
    await waitFor(() => expect(getZoomControls().zoomInTrigger).toBeDisabled())
  })

  it('renders collaboration menu entries only when collaboration is enabled', async () => {
    const user = userEvent.setup()
    collaborationEnabled = false
    renderZoomInOut()

    const menu = await openZoomMenu(user)
    expect(
      menu.getByRole('menuitemcheckbox', { name: 'workflow.operator.showMiniMap' }),
    ).toBeInTheDocument()
    expect(
      menu.queryByRole('menuitemcheckbox', { name: 'workflow.operator.showUserComments' }),
    ).not.toBeInTheDocument()
    expect(
      menu.queryByRole('menuitemcheckbox', { name: 'workflow.operator.showUserCursors' }),
    ).not.toBeInTheDocument()
  })
})
