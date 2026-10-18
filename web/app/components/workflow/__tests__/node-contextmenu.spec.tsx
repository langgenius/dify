import type { Node } from '../types'
import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { NodeContextmenu } from '../node-contextmenu'
import { createNode } from './fixtures'
import { renderWorkflowComponent } from './workflow-test-env'

const mockUseNodeActionsMenuModel = vi.hoisted(() => vi.fn())
const copy = vi.fn()
const duplicate = vi.fn()
const removeNode = vi.fn()

vi.mock('@/app/components/workflow/node-actions-menu/use-node-actions-menu-model', () => ({
  useNodeActionsMenuModel: (props: unknown) => mockUseNodeActionsMenuModel(props),
}))

describe('NodeContextmenu', () => {
  const mockClose = vi.fn()
  let contextMenuTarget: { type: 'node'; nodeId: string } | undefined
  let nodes: Node[]

  beforeEach(() => {
    vi.clearAllMocks()
    contextMenuTarget = undefined
    nodes = [createNode({ id: 'node-1', data: { title: 'Node 1' } })]
    mockUseNodeActionsMenuModel.mockImplementation(
      (props: { id: string; data: Node['data']; onClose: () => void }) => ({
        about: {
          author: 'Dify',
          description: 'Node actions',
        },
        canChangeBlock: false,
        canRun: false,
        data: props.data,
        handleCopy: () => {
          copy()
          props.onClose()
        },
        handleDelete: () => {
          removeNode()
          props.onClose()
        },
        handleDuplicate: () => {
          duplicate()
          props.onClose()
        },
        handleRun: props.onClose,
        helpLinkUri: undefined,
        id: props.id,
        isSingleton: false,
        isUndeletable: false,
        nodesReadOnly: false,
        sourceHandle: 'source',
        workflowAppHref: undefined,
      }),
    )
  })

  const renderNodeContextmenu = () =>
    renderWorkflowComponent(
      <ReactFlowProvider>
        <ContextMenu open>
          <NodeContextmenu onClose={mockClose} />
        </ContextMenu>
      </ReactFlowProvider>,
      { initialStoreState: { nodes, contextMenuTarget } },
    )

  it.each([
    ['c', copy],
    ['d', duplicate],
    ['Delete', removeNode],
  ] as const)(
    'routes %s from the node context menu to its matching action',
    async (key, handler) => {
      const user = userEvent.setup()
      contextMenuTarget = { type: 'node', nodeId: 'node-1' }
      renderNodeContextmenu()
      const item = screen.getByRole('menuitem', { name: /workflow.common.copy/ })
      act(() => item.focus())
      const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
      await user.keyboard(key.length === 1 ? `{${mod}>}${key}{/${mod}}` : `{${key}}`)
      expect(mockClose).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledOnce()
      for (const other of [copy, duplicate, removeNode].filter((action) => action !== handler))
        expect(other).not.toHaveBeenCalled()
    },
  )

  it('should stay hidden when the node menu is absent', () => {
    renderNodeContextmenu()

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mockUseNodeActionsMenuModel).not.toHaveBeenCalled()
  })

  it('should stay hidden when the referenced node cannot be found', () => {
    contextMenuTarget = { type: 'node', nodeId: 'missing-node' }

    renderNodeContextmenu()

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mockUseNodeActionsMenuModel).not.toHaveBeenCalled()
  })
})
