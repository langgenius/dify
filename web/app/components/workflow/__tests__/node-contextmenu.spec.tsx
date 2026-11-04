import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { fullWorkflowAccessControl } from '../hooks-store'
import { NodeContextmenu } from '../node-contextmenu'
import { BlockEnum } from '../types'
import { CANVAS_NODES_STATUS_NAME, CanvasNodesCatalogProbe } from './canvas-nodes-catalog-probe'
import { createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

function ControlledNodeMenu({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true)

  return (
    <>
      <ContextMenu open={open}>
        <NodeContextmenu
          onClose={() => {
            setOpen(false)
            onClose()
          }}
        />
      </ContextMenu>
      <CanvasNodesCatalogProbe />
    </>
  )
}

function renderNodeContextmenu(nodeId?: string) {
  const nodes = [
    createNode({
      id: 'node-1',
      width: 240,
      height: 80,
      data: { type: BlockEnum.Code, title: 'Node 1' },
    }),
  ]
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  const onClose = vi.fn()
  const rendered = renderWorkflowFlowComponent(<ControlledNodeMenu onClose={onClose} />, {
    nodes,
    edges: [],
    queryClient,
    hooksStoreProps: {
      accessControl: fullWorkflowAccessControl,
      doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
    },
    initialStoreState: nodeId
      ? { nodes, contextMenuTarget: { type: 'node', nodeId } }
      : { nodes, contextMenuTarget: undefined },
    reactFlowProps: { fitView: false },
  })

  return { ...rendered, onClose }
}

function canvasNodeIds() {
  return (
    screen.getByRole('status', { name: CANVAS_NODES_STATUS_NAME }).textContent?.split(',') ?? []
  ).filter(Boolean)
}

describe('NodeContextmenu', () => {
  it.each([
    { key: 'c', action: 'copy' },
    { key: 'd', action: 'duplicate' },
    { key: 'Delete', action: 'delete' },
  ] as const)('routes $key through the real $action action', async ({ key, action }) => {
    const user = userEvent.setup()
    const { onClose, store } = renderNodeContextmenu('node-1')
    await screen.findByRole('menu')
    await user.keyboard('{ArrowDown}')

    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(key.length === 1 ? `{${mod}>}${key}{/${mod}}` : `{${key}}`)

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(onClose).toHaveBeenCalledOnce()

    if (action === 'copy') {
      expect(store.getState().clipboardElements.map((node) => node.id)).toEqual(['node-1'])
      await waitFor(async () => {
        const clipboard = JSON.parse(await navigator.clipboard.readText()) as {
          nodes: Array<{ id: string }>
        }
        expect(clipboard.nodes.map((node) => node.id)).toEqual(['node-1'])
      })
      expect(canvasNodeIds()).toEqual(['node-1'])
    } else if (action === 'duplicate') {
      await waitFor(() => expect(canvasNodeIds()).toHaveLength(2))
      expect(canvasNodeIds()).toContain('node-1')
      expect(new Set(canvasNodeIds())).toHaveLength(2)
    } else {
      await waitFor(() => expect(canvasNodeIds()).toEqual([]))
    }
  })

  it('stays hidden when the node menu is absent', () => {
    renderNodeContextmenu()

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('stays hidden when the referenced node cannot be found', () => {
    renderNodeContextmenu('missing-node')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
