import { userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createEdge, createNode } from '../../__tests__/fixtures'
import {
  initialNodes,
  recordHistory,
  redo,
  setupWorkflowCanvas,
  undo,
} from './workflow-canvas-test-env'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('Workflow canvas graph deletion and history', () => {
  it('keeps canvas focus when deletion and redo remove the focused node', async () => {
    const screen = await setupWorkflowCanvas()
    const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
    const node = screen.getByRole('button', { name: 'Workflow node' })
    await node.click()
    await recordHistory(() => userEvent.keyboard('{Delete}'))
    await expect.element(node).not.toBeInTheDocument()
    await expect.element(canvas).toHaveFocus()
    expect(screen.graphNodes().map((node) => node.id)).toEqual(['anchor'])

    await undo()
    await expect.element(node).toBeInTheDocument()
    await node.click()
    await redo()
    await expect.element(node).not.toBeInTheDocument()
    await expect.element(canvas).toHaveFocus()
    await undo()
    await expect.element(node).toBeInTheDocument()
  })

  it.each(['menu', 'note'] as const)(
    'returns to canvas undo after the %s dropdown deletes its trigger',
    async (type) => {
      const screen = await setupWorkflowCanvas({
        nodes: initialNodes.map((node) => (node.id === 'node' ? { ...node, type } : node)),
      })
      const more = screen.getByRole('button', { name: 'common.operation.more' })
      await more.click()
      await recordHistory(() =>
        screen.getByRole('menuitem', { name: /common.operation.delete/ }).click(),
      )
      await expect.element(more).not.toBeInTheDocument()
      await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
      expect(screen.graphNodes().map((node) => node.id)).toEqual(['anchor'])
      await undo()
      await expect.element(more).toBeInTheDocument()
      expect(screen.graphNodes().map((node) => node.id)).toEqual(['node', 'anchor'])
    },
  )

  it('returns to canvas undo after a node context menu removes its focus target', async () => {
    const screen = await setupWorkflowCanvas({ contextMenuType: 'node' })
    const node = screen.getByRole('button', { name: 'Workflow node' })
    await node.click({ button: 'right' })
    await recordHistory(() =>
      screen.getByRole('menuitem', { name: /common.operation.delete/ }).click(),
    )
    await expect.element(node).not.toBeInTheDocument()
    await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
    await undo()
    await expect.element(node).toBeInTheDocument()
  })

  it('returns to canvas undo after deleting an edge through its context menu', async () => {
    const nodes = [
      ...initialNodes,
      createNode({
        id: 'other',
        type: 'default',
        position: { x: 500, y: 300 },
        data: { label: 'Other node' },
      }),
    ]
    const edges = [
      createEdge({
        id: 'edge',
        source: 'node',
        target: 'other',
        sourceHandle: undefined,
        targetHandle: undefined,
        type: 'default',
      }),
    ]
    const screen = await setupWorkflowCanvas({ nodes, edges, contextMenuType: 'edge' })
    const edge = screen.getByTestId('rf__edge-edge')
    await screen.getByLabelText('Outside canvas input').click()
    await edge.click({ button: 'right' })
    await recordHistory(() =>
      screen.getByRole('menuitem', { name: /common.operation.delete/ }).click(),
    )
    await expect.element(edge).not.toBeInTheDocument()
    await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
    expect(screen.graphEdges()).toEqual([])

    await undo()
    await expect.element(edge).toBeInTheDocument()
    expect(screen.graphEdges()).toMatchObject(edges)
    await edge.click({ button: 'right' })
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('region', { name: 'app.types.workflow' })).toHaveFocus()
  })

  it('returns to canvas undo after deleting a native drag selection from its context menu', async () => {
    const nodes = [
      ...initialNodes,
      createNode({
        id: 'other',
        type: 'default',
        ariaLabel: 'Other node',
        position: { x: 500, y: 300 },
        data: { label: 'Other node' },
      }),
    ]
    const screen = await setupWorkflowCanvas({ nodes, contextMenuType: 'selection' })
    const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
    await userEvent.dragAndDrop(canvas, canvas, {
      sourcePosition: { x: 300, y: 120 },
      targetPosition: { x: 700, y: 380 },
      steps: 5,
    })
    await canvas.click({ button: 'right', position: { x: 450, y: 220 } })
    await recordHistory(() =>
      screen.getByRole('menuitem', { name: /common.operation.delete/ }).click(),
    )
    await expect
      .element(screen.getByRole('button', { name: 'Workflow node' }))
      .not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Other node' })).not.toBeInTheDocument()
    await expect.element(canvas).toHaveFocus()
    expect(screen.graphNodes().map((node) => node.id)).toEqual(['anchor'])
    await undo()
    await expect.element(screen.getByRole('button', { name: 'Workflow node' })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Other node' })).toBeInTheDocument()
  })
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
