import { userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ControlMode } from '../../types'
import { initialNodes, mod, redo, setupWorkflowCanvas, undo } from './workflow-canvas-test-env'

describe('Workflow canvas focus and shortcut ownership', () => {
  it('admits and releases keyboard focus while keeping mode and zoom shortcuts inside the canvas', async () => {
    const screen = await setupWorkflowCanvas({}, true)
    const before = screen.getByRole('button', { name: 'Before canvas' })
    const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
    const node = screen.getByRole('button', { name: 'Workflow node' })
    await userEvent.tab()
    await expect.element(before).toHaveFocus()
    await userEvent.tab()
    await expect.element(canvas).toHaveFocus()

    const width = node.element().getBoundingClientRect().width
    expect(width).toBeGreaterThan(0)
    await userEvent.keyboard('{Shift>}[Digit5]{/Shift}')
    await expect.poll(() => node.element().getBoundingClientRect().width).toBeCloseTo(width / 2)
    await userEvent.keyboard('{Shift>}[Digit1]{/Shift}')
    await expect.poll(() => node.element().getBoundingClientRect().width).toBeCloseTo(width)

    for (const [key, mode] of [
      ['v', ControlMode.Pointer],
      ['h', ControlMode.Hand],
      ['c', ControlMode.Comment],
    ] as const) {
      await userEvent.keyboard(key)
      expect(screen.store.getState().controlMode).toBe(mode)
    }
    await userEvent.keyboard('v')
    await userEvent.tab({ shift: true })
    await expect.element(before).toHaveFocus()
    await userEvent.keyboard('hc{Shift>}[Digit5]{/Shift}')
    expect(screen.store.getState().controlMode).toBe(ControlMode.Pointer)
    expect(node.element().getBoundingClientRect().width).toBeCloseTo(width)

    await screen.getByRole('textbox', { name: 'workflow.nodes.note.editor.label' }).click()
    await userEvent.keyboard('hc')
    expect(screen.store.getState().controlMode).toBe(ControlMode.Pointer)
  })

  it('acquires focus from canvas clicks while leaving editor undo and outside shortcuts alone', async () => {
    const screen = await setupWorkflowCanvas()
    const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
    await canvas.click({ position: { x: 650, y: 400 } })
    await expect.element(canvas).toHaveFocus()
    await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
    screen.store.getState().flushPendingSync()
    expect(screen.save).toHaveBeenCalledOnce()

    const node = screen.getByRole('button', { name: 'Workflow node' })
    await node.click()
    await expect.element(node).toHaveFocus()
    const prompt = screen.getByRole('textbox', { name: 'Node prompt' })
    await prompt.click()
    await userEvent.keyboard('Draft text')
    await expect.element(prompt).toHaveValue('Draft text')
    await undo()
    await expect.element(prompt).toHaveValue('')
    expect(screen.graphNodes().map((node) => node.id)).toEqual(['node', 'anchor'])
    expect(screen.store.temporal.getState().pastStates).toHaveLength(0)

    await screen.getByRole('button', { name: 'Popup action' }).click()
    await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
    screen.store.getState().flushPendingSync()
    expect(screen.save).toHaveBeenCalledOnce()
    await canvas.click({ position: { x: 650, y: 400 } })
    await userEvent.keyboard(`{${mod}>}s{/${mod}}`)
    screen.store.getState().flushPendingSync()
    expect(screen.save).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['pointer', 'v'],
    ['hand', 'h'],
    ['comment', 'c'],
  ])('pans without zooming while the %s tool is active', async (_, key) => {
    const screen = await setupWorkflowCanvas({}, true)
    const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
    const node = screen.getByRole('button', { name: 'Workflow node' })
    await canvas.click({ position: { x: 650, y: 400 } })
    await expect.element(canvas).toHaveFocus()
    await expect.element(node).toBeVisible()

    const bounds = () => node.element().getBoundingClientRect()
    await userEvent.keyboard(key)
    const before = bounds()
    await canvas.wheel({ delta: { x: 40, y: 24 } })
    await expect.poll(() => bounds().left).toBeLessThan(before.left)
    expect(bounds().top).toBeLessThan(before.top)
    expect(bounds().width).toBeCloseTo(before.width)
  })

  it('zooms when scrolling with the platform modifier', async () => {
    const screen = await setupWorkflowCanvas()
    const canvas = screen.getByRole('region', { name: 'app.types.workflow' })
    const node = screen.getByRole('button', { name: 'Workflow node' })
    await canvas.click({ position: { x: 650, y: 400 } })
    await expect.element(canvas).toHaveFocus()
    const width = () => node.element().getBoundingClientRect().width
    const before = width()
    await userEvent.keyboard(`{${mod}>}`)
    try {
      await canvas.wheel({ delta: { x: 0, y: -100 } })
      await expect.poll(width).toBeGreaterThan(before)
    } finally {
      await userEvent.keyboard(`{/${mod}}`)
    }
  })

  it('lets the production Note editor own text undo and redo', async () => {
    const screen = await setupWorkflowCanvas()
    const note = screen.getByRole('textbox', { name: 'workflow.nodes.note.editor.label' })
    await note.click()
    await userEvent.keyboard('Note text')
    await expect.element(note).toHaveTextContent('Note text')
    await undo()
    await expect.element(note).toBeEmptyDOMElement()
    await redo()
    await expect.element(note).toHaveTextContent('Note text')
    expect(screen.graphNodes().map((node) => node.id)).toEqual(['node', 'anchor'])
    expect(screen.store.temporal.getState().pastStates).toHaveLength(0)
  })

  it('keeps focus on an outside input when it dismisses a node dropdown', async () => {
    const screen = await setupWorkflowCanvas({
      nodes: initialNodes.map((node) => (node.id === 'node' ? { ...node, type: 'menu' } : node)),
    })
    await screen.getByRole('button', { name: 'common.operation.more' }).click()
    await expect
      .element(screen.getByRole('menuitem', { name: /workflow.common.copy/ }))
      .toBeVisible()
    const outside = screen.getByRole('textbox', { name: 'Outside canvas input' })
    await outside.click()
    await expect
      .element(screen.getByRole('menuitem', { name: /workflow.common.copy/ }))
      .not.toBeInTheDocument()
    await expect.element(outside).toHaveFocus()
  })
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
