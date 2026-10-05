import { useState } from 'react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { WorkflowContext } from '../context'
import { HooksStoreContext } from '../hooks-store/provider'
import { createHooksStore } from '../hooks-store/store'
import { createWorkflowStore } from '../store/workflow'
import { WorkflowContextmenu } from '../workflow-contextmenu'
import { createNode } from './fixtures'
import 'reactflow/dist/style.css'

const transport = vi.hoisted(() => vi.fn())
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))

vi.mock('@/service/base', () => ({
  get: vi.fn().mockResolvedValue([]),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
  upload: vi.fn(),
  sseGeneratorPost: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postMarketplace: vi.fn(),
  postPublic: vi.fn(),
  delPublic: vi.fn(),
  patchPublic: vi.fn(),
}))

// Canvas editing commands are independent of the real snippet command and its dialog session.
vi.mock('../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodesCopy: vi.fn(),
    handleNodesDuplicate: vi.fn(),
    handleNodesDelete: vi.fn(),
  }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ appId: 'workflow-app' }),
  usePathname: () => '/app/workflow-app/workflow',
  useSearchParams: () => new URLSearchParams(),
}))

const nodes = [
  createNode({ id: 'first', selected: true, width: 80, height: 40 }),
  createNode({ id: 'second', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
]

function SelectionFixture() {
  const [workflow] = useState(() => {
    const store = createWorkflowStore({})
    store.getState().setWorkflowHistory({ nodes, edges: [], workflowHistoryEvent: undefined })
    return store
  })
  const [hooks] = useState(() => createHooksStore({}))
  return (
    <WorkflowContext value={workflow}>
      <HooksStoreContext value={hooks}>
        <ReactFlowProvider>
          <WorkflowContextmenu>
            <div
              role="application"
              aria-label="Workflow selection"
              style={{ width: 800, height: 500 }}
            >
              <ReactFlow
                nodes={nodes}
                edges={[]}
                fitView
                onNodeContextMenu={() =>
                  workflow.getState().setContextMenuTarget({ type: 'selection' })
                }
                onPaneContextMenu={() =>
                  workflow.getState().setContextMenuTarget({ type: 'selection' })
                }
              />
            </div>
          </WorkflowContextmenu>
        </ReactFlowProvider>
      </HooksStoreContext>
    </WorkflowContext>
  )
}

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps the selected snippet draft through exit after its context menu has disappeared', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  transport.mockResolvedValue({ data: [] })
  const { wrapper: Providers, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['snippets.create_and_modify'],
  })
  await page.viewport(1000, 700)
  const screen = await render(
    <Providers>
      <SelectionFixture />
    </Providers>,
  )
  await screen.getByLabelText('Workflow selection').click({ button: 'right' })
  await screen.getByRole('menuitem', { name: /^workflow.snippet.createDialogTitle/ }).click()
  const dialog = screen.getByRole('dialog', { name: 'workflow.snippet.createDialogTitle' })
  await expect.element(dialog).toBeVisible()
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  const name = screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })
  await name.fill('Selected graph draft')
  const popup = dialog.element()
  await expect
    .poll(
      () =>
        !popup.hasAttribute('data-starting-style') &&
        popup.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  let draftDuringExit: string | undefined
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style'))
      draftDuringExit = (name.element() as HTMLInputElement).value
  })
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => draftDuringExit).toBe('Selected graph draft')
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect
    .poll(() =>
      screen.getByLabelText('Workflow selection').element().contains(document.activeElement),
    )
    .toBe(true)
  expect(
    document.activeElement?.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
  ).toBe(true)
  await screen.getByLabelText('Workflow selection').click({ button: 'right' })
  await screen.getByRole('menuitem', { name: /^workflow.snippet.createDialogTitle/ }).click()
  await expect.element(name).toHaveValue('')
  const reopenedPopup = dialog.element()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => reopenedPopup.isConnected).toBe(false)
  queryClient.clear()
})
