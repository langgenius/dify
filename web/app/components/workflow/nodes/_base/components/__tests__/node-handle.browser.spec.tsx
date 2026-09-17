import type { RefObject } from 'react'
import type { Connection, NodeProps } from 'reactflow'
import type { CommonNodeType, OnSelectBlock } from '../../../../types'
import type { HumanInputNodeType } from '../../../human-input/types'
import { useRef, useState } from 'react'
import ReactFlow, { ReactFlowProvider, useReactFlow } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkflowContext } from '../../../../context'
import CustomEdge from '../../../../custom-edge'
import { useWorkflowControlScale } from '../../../../hooks/use-workflow-control-scale'
import { createWorkflowStore } from '../../../../store/workflow'
import { BlockEnum } from '../../../../types'
import HumanInputNode from '../../../human-input/node'
import { UserActionButtonType } from '../../../human-input/types'
import { NodeSourceHandle, NodeTargetHandle } from '../node-handle'
import 'reactflow/dist/style.css'
import '../../../../style.css'

const { handleNodeAdd } = vi.hoisted(() => ({ handleNodeAdd: vi.fn() }))

vi.mock('../../../../hooks/use-available-blocks', () => ({
  useAvailableBlocks: () => ({
    availablePrevBlocks: [BlockEnum.Code],
    availableNextBlocks: [BlockEnum.Code],
  }),
}))
vi.mock('../../../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeAdd }),
}))
vi.mock('../../../../hooks/use-workflow', () => ({
  useIsChatMode: () => false,
  useNodesReadOnly: () => ({ getNodesReadOnly: () => false }),
}))
vi.mock('../../../../hooks-store', () => ({
  useHooksStore: (selector: (state: object) => unknown) => selector({}),
}))
// Search results are outside the handle's hit testing and connection contract.
vi.mock('../../../../block-selector/tabs', () => ({
  BlockSelectorPanels: ({
    searchInputRef,
    onSelect,
  }: {
    searchInputRef: RefObject<HTMLInputElement>
    onSelect: OnSelectBlock
  }) => (
    <>
      <input ref={searchInputRef} aria-label="Find a node" />
      <button type="button" onClick={() => onSelect(BlockEnum.Code)}>
        Add code node
      </button>
    </>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function HandleNode({ id, data }: NodeProps<CommonNodeType>) {
  return (
    <div role="group" aria-label={data.title} className="group" style={{ width: 160, height: 80 }}>
      {data.title}
      {id === 'source' ? (
        <NodeSourceHandle id={id} data={data} handleId="out" />
      ) : (
        <NodeTargetHandle id={id} data={data} handleId="in" />
      )}
    </div>
  )
}

function HumanInputHandleNode({ id, data }: NodeProps<HumanInputNodeType>) {
  return (
    <div role="group" aria-label={data.title} className="group" style={{ width: 240 }}>
      <HumanInputNode id={id} data={data} />
    </div>
  )
}

const nodeTypes = { handles: HandleNode, humanInput: HumanInputHandleNode }
const edgeTypes = { custom: CustomEdge }
const nodes = [
  {
    id: 'source',
    type: 'handles',
    position: { x: 100, y: 160 },
    data: { title: 'Source node', desc: '', type: BlockEnum.Code },
  },
  {
    id: 'target',
    type: 'handles',
    position: { x: 600, y: 160 },
    data: { title: 'Target node', desc: '', type: BlockEnum.Code },
  },
]

const humanInputData: HumanInputNodeType = {
  title: 'Human input node',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [],
  form_content: 'Please review this request',
  inputs: [],
  user_actions: [
    { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
    { id: 'reject', title: 'Reject', button_style: UserActionButtonType.Default },
  ],
  timeout: 3,
  timeout_unit: 'day',
}

function Canvas({
  initialZoom = 1,
  showEdge = false,
  humanInput = false,
}: {
  initialZoom?: number
  showEdge?: boolean
  humanInput?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setViewport } = useReactFlow()
  const [connection, setConnection] = useState<Connection | null>(null)
  useWorkflowControlScale(containerRef)
  return (
    <>
      {[1, 0.5, 0.25].map((zoom) => (
        <button key={zoom} type="button" onClick={() => setViewport({ x: 0, y: 0, zoom })}>
          Zoom {zoom * 100}%
        </button>
      ))}
      <output aria-label="Connection">
        {connection &&
          `${connection.source}:${connection.sourceHandle} → ${connection.target}:${connection.targetHandle}`}
      </output>
      <div ref={containerRef} style={{ width: 900, height: 400 }}>
        <ReactFlow
          defaultNodes={
            humanInput
              ? nodes.map((node) =>
                  node.id === 'source'
                    ? { ...node, type: 'humanInput', data: humanInputData }
                    : node,
                )
              : nodes
          }
          defaultViewport={{ x: 0, y: 0, zoom: initialZoom }}
          defaultEdges={
            showEdge
              ? [
                  {
                    id: 'connection',
                    source: 'source',
                    sourceHandle: 'out',
                    target: 'target',
                    targetHandle: 'in',
                    type: 'custom',
                    data: { sourceType: BlockEnum.Code, targetType: BlockEnum.Code },
                  },
                ]
              : []
          }
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.25}
          nodesFocusable={false}
          onConnect={setConnection}
        />
      </div>
    </>
  )
}

function Fixture(props: { initialZoom?: number; showEdge?: boolean; humanInput?: boolean }) {
  const [store] = useState(() => createWorkflowStore({}))
  return (
    <WorkflowContext value={store}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </WorkflowContext>
  )
}

it.each([1, 0.5, 0.25])(
  'keeps real handles clickable at their edges and draggable at zoom %s',
  async (zoom) => {
    // Native hit testing under both ReactFlow and control transforms is not represented by DOM unit tests.
    await page.viewport(1100, 700)
    const screen = await render(<Fixture />)
    await screen.getByRole('button', { name: `Zoom ${zoom * 100}%` }).click()
    // ReactFlow handle elements are a canvas boundary without a semantic locator.
    const source = page.elementLocator(
      screen
        .getByRole('group', { name: 'Source node' })
        .element()
        .querySelector('[data-handleid="out"]')!,
    )
    const target = page.elementLocator(
      screen
        .getByRole('group', { name: 'Target node' })
        .element()
        .querySelector('[data-handleid="in"]')!,
    )

    for (const handle of [source, target]) {
      const button = page
        .elementLocator(handle.element())
        .getByRole('button', { name: 'workflow.common.addBlock' })
      await expect.poll(() => button.element().getBoundingClientRect().width).toBeCloseTo(24)
      expect(button.element().getBoundingClientRect().height).toBeCloseTo(24)
      const handleBounds = handle.element().getBoundingClientRect()
      const buttonBounds = button.element().getBoundingClientRect()
      await handle.click({
        position: {
          x: buttonBounds.left + 1 - handleBounds.left,
          y: buttonBounds.top + 1 - handleBounds.top,
        },
      })
      await expect.element(screen.getByRole('textbox', { name: 'Find a node' })).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      await expect
        .element(screen.getByRole('textbox', { name: 'Find a node' }))
        .not.toBeInTheDocument()
    }

    await userEvent.dragAndDrop(source, target)
    await expect
      .element(screen.getByLabelText('Connection'))
      .toHaveTextContent('source:out → target:in')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  },
)

it('keeps a saved connection anchored to the port centers when initialized at 25% zoom', async () => {
  await page.viewport(1100, 700)
  const screen = await render(<Fixture initialZoom={0.25} showEdge />)
  const source = screen
    .getByRole('group', { name: 'Source node' })
    .element()
    .querySelector('[data-handleid="out"]')!
  const target = screen
    .getByRole('group', { name: 'Target node' })
    .element()
    .querySelector('[data-handleid="in"]')!
  const path = () => document.querySelector<SVGPathElement>('.react-flow__edge-path')!
  await expect.poll(() => path()).not.toBeNull()

  const endpoint = (atEnd: boolean) => {
    const edge = path()
    return edge
      .getPointAtLength(atEnd ? edge.getTotalLength() : 0)
      .matrixTransform(edge.getScreenCTM()!)
  }
  for (const [port, atEnd] of [
    [source, false],
    [target, true],
  ] as const) {
    await expect
      .poll(() => {
        const bounds = port.getBoundingClientRect()
        const point = endpoint(atEnd)
        return Math.hypot(
          point.x - (bounds.left + bounds.width / 2),
          point.y - (bounds.top + bounds.height / 2),
        )
      })
      .toBeLessThan(0.5)
  }
})

it('adds and connects the intended human input branch at 25% zoom', async () => {
  // The production branch rows are closer than 24 screen pixels at this zoom.
  // Native hit testing must route clicks and drags to the selected branch, not its neighbor.
  await page.viewport(1100, 700)
  const screen = await render(<Fixture initialZoom={0.25} humanInput />)
  const sourceNode = screen.getByRole('group', { name: 'Human input node' })
  const target = page.elementLocator(
    screen
      .getByRole('group', { name: 'Target node' })
      .element()
      .querySelector('[data-handleid="in"]')!,
  )

  for (const handleId of ['approve', 'reject', '__timeout']) {
    // ReactFlow exposes handle IDs at the canvas boundary, without semantic roles.
    const source = page.elementLocator(
      sourceNode.element().querySelector(`[data-handleid="${handleId}"]`)!,
    )
    await source.click()
    await screen.getByRole('button', { name: 'Add code node' }).click()
    expect(handleNodeAdd).toHaveBeenLastCalledWith(
      { nodeType: BlockEnum.Code, pluginDefaultValue: undefined },
      { prevNodeId: 'source', prevNodeSourceHandle: handleId },
    )
    await expect
      .element(screen.getByRole('textbox', { name: 'Find a node' }))
      .not.toBeInTheDocument()

    await userEvent.dragAndDrop(source, target)
    await expect
      .element(screen.getByLabelText('Connection'))
      .toHaveTextContent(`source:${handleId} → target:in`)
  }
})
