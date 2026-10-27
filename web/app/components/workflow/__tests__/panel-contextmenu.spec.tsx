import type { AvailableNodesMetaData } from '../hooks-store'
import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { useQueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { use, useLayoutEffect, useState } from 'react'
import { useStoreApi } from 'reactflow'
import { seedSystemFeatures } from '@/test/console/query-data'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import { fullWorkflowAccessControl, HooksStoreContext } from '../hooks-store'
import { useWorkflowNodeCatalog } from '../node-catalog'
import codeDefault from '../nodes/code/default'
import { CUSTOM_NOTE_NODE } from '../note-node/constants'
import { PanelContextmenu } from '../panel-contextmenu'
import { BlockEnum } from '../types'
import { createNode } from './fixtures'

const copied = createNode({
  id: 'copied-node',
  data: { ...codeDefault.defaultValue, type: BlockEnum.Code, title: 'Copied code' },
})

function setup(options: Parameters<typeof renderWorkflowEditor>[1] = {}) {
  const user = userEvent.setup()
  const run = vi.fn()
  const preview = vi.fn()
  const exportDSL = vi.fn(async () => {})
  let flow: ReturnType<typeof useStoreApi>
  let queryClient: ReturnType<typeof useQueryClient>
  function Menu() {
    flow = useStoreApi()
    queryClient = useQueryClient()
    const [open, setOpen] = useState(true)
    const catalog = useWorkflowNodeCatalog()
    const hooksStore = use(HooksStoreContext)!
    useLayoutEffect(() => {
      const nodesMap = catalog.nodesMap as NonNullable<AvailableNodesMetaData['nodesMap']>
      hooksStore.setState({
        availableNodesMetaData: {
          nodes: catalog.nodes.map((node) => nodesMap[node.metaData.type]),
          nodesMap,
        },
      })
    }, [catalog, hooksStore])
    return (
      <ContextMenu open={open} onOpenChange={setOpen}>
        <PanelContextmenu onClose={() => setOpen(false)} />
      </ContextMenu>
    )
  }
  const result = renderWorkflowEditor(<Menu />, {
    nodes: [],
    edges: [],
    historyStore: { nodes: [], edges: [] },
    ...options,
    initialStoreState: { contextMenuTarget: { type: 'panel' }, ...options.initialStoreState },
    hooksStoreProps: {
      // Execution and DSL export are supplied by the owning app or snippet editor.
      handleStartWorkflowRun: run,
      handleWorkflowStartRunInChatflow: preview,
      exportCheck: exportDSL,
      ...options.hooksStoreProps,
    },
  })
  return {
    ...result,
    queryClient: queryClient!,
    user,
    run,
    preview,
    exportDSL,
    nodes: () => flow.getState().getNodes(),
  }
}

it('stays hidden without a panel menu target', () => {
  setup({ initialStoreState: { contextMenuTarget: undefined } })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('disables click and keyboard paste when the clipboard is empty', async () => {
  const { user, nodes } = setup()
  const paste = await screen.findByRole('menuitem', { name: /workflow.common.pasteHere/ })
  expect(paste).toHaveAttribute('aria-disabled', 'true')
  await user.click(paste)
  const run = screen.getByRole('menuitem', { name: /workflow.common.run/ })
  act(() => run.focus())
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await user.keyboard(`{${mod}>}v{/${mod}}`)
  expect(nodes()).toEqual([])
  expect(screen.getByRole('menu')).toBeVisible()
})

it.each(['click', 'keyboard'] as const)(
  'pastes a real graph node through %s and closes the menu',
  async (input) => {
    const { user, nodes } = setup({ initialStoreState: { clipboardElements: [copied] } })
    const paste = await screen.findByRole('menuitem', { name: /workflow.common.pasteHere/ })
    if (input === 'click') await user.click(paste)
    else {
      act(() => paste.focus())
      const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
      await user.keyboard(`{${mod}>}v{/${mod}}`)
    }
    await waitFor(() => expect(nodes()).toHaveLength(1))
    expect(nodes()[0]?.data).toMatchObject({ type: BlockEnum.Code, title: 'Copied code' })
    expect(nodes()[0]?.id).not.toBe(copied.id)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  },
)

it('starts placing a real note from the menu', async () => {
  const { user, store } = setup()
  await user.click(await screen.findByRole('menuitem', { name: 'workflow.nodes.note.addNote' }))
  expect(store.getState().candidateNode).toMatchObject({
    type: CUSTOM_NOTE_NODE,
    data: { text: '', _isCandidate: true },
  })
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
})

it.each([
  ['workflow', 'workflow.common.run'],
  ['advanced-chat', 'workflow.common.debugAndPreview'],
] as const)('dispatches the %s execution command and closes the menu', async (mode, label) => {
  const { user, run, preview } = setup({ resource: { kind: 'app', appId: 'app-1', mode } })
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(label) }))
  expect(run).toHaveBeenCalledTimes(mode === 'workflow' ? 1 : 0)
  expect(preview).toHaveBeenCalledTimes(mode === 'advanced-chat' ? 1 : 0)
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
})

it('dispatches export to the owning editor', async () => {
  const { user, exportDSL } = setup()
  await user.click(await screen.findByRole('menuitem', { name: 'app.exportApp' }))
  expect(exportDSL).toHaveBeenCalledOnce()
})

it('opens app import but omits that action for snippets', async () => {
  const { user, store, unmount } = setup()
  await user.click(await screen.findByRole('menuitem', { name: 'app.importApp' }))
  expect(store.getState().showImportDSLModal).toBe(true)
  unmount()
  setup({
    resource: { kind: 'snippet', snippetId: 'snippet-1' },
    hooksStoreProps: { fileSettings: {} },
  })
  expect(await screen.findByRole('menuitem', { name: 'app.exportApp' })).toBeVisible()
  expect(screen.queryByRole('menuitem', { name: 'app.importApp' })).not.toBeInTheDocument()
})

it('allows comments but not node editing when editing permission is denied', async () => {
  const { user, store, queryClient } = setup({
    hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canEdit: false } },
  })
  act(() => seedSystemFeatures(queryClient, { enable_collaboration_mode: true }))
  const comment = await screen.findByRole('menuitem', {
    name: 'workflowComments.comments.actions.addComment',
  })
  expect(screen.queryByText('workflow.nodes.note.addNote')).not.toBeInTheDocument()
  expect(screen.queryByText('workflow.common.addBlock')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('menuitem', { name: /workflow.common.pasteHere/ }),
  ).not.toBeInTheDocument()
  await user.click(comment)
  expect(store.getState()).toMatchObject({ isCommentQuickAdd: true, isCommentPlacing: true })
  expect(store.getState().candidateNode).toBeUndefined()
})
