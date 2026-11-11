import type { NodeProps } from 'reactflow'
import type { Node } from '../../types'
import { useState } from 'react'
import { Handle, Position, useStore as useReactFlowStore } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderWorkflowBrowserComponent as render } from '../../__tests__/workflow-browser-test-env'
import { useNodeKeyboardInteractions } from '../../hooks/use-node-keyboard-interactions'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import VarReferenceVars from '../../nodes/_base/components/variable/var-reference-vars'
import { BlockEnum, VarType } from '../../types'
import { WorkflowCanvas } from '../workflow-canvas'
import 'reactflow/dist/style.css'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function VariableConnectionNode({ id }: NodeProps) {
  return (
    <div style={{ width: 150, height: 80 }}>
      {id}
      <Handle type="source" position={Position.Right} data-testid={`source-${id}`} />
      <Handle type="target" position={Position.Left} data-testid={`target-${id}`} />
    </div>
  )
}

const variableConnectionNodeTypes = { connection: VariableConnectionNode }
const variableConnectionNodes: Node[] = [
  {
    id: 'source',
    type: 'connection',
    position: { x: 100, y: 150 },
    data: { type: BlockEnum.Code, title: 'Source', desc: '' },
  },
  {
    id: 'assigner',
    type: 'connection',
    position: { x: 500, y: 150 },
    data: { type: BlockEnum.VariableAssigner, title: 'Assigner', desc: '' },
  },
]

function VariableConnectionCanvas() {
  const [showPicker, setShowPicker] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const canvas = useReactFlowStore((state) => state.domNode)
  const { handleNodeSelect } = useNodesInteractions()
  const handleNodeKeyDown = useNodeKeyboardInteractions(handleNodeSelect)

  return (
    <>
      <div style={{ width: 800, height: 500 }}>
        <WorkflowCanvas
          nodes={variableConnectionNodes}
          edges={[]}
          nodeTypes={variableConnectionNodeTypes}
          onKeyDownCapture={handleNodeKeyDown}
          onConnectEnd={() => setShowPicker(true)}
          deleteKeyCode={null}
        >
          {showPicker && (
            <VarReferenceVars
              hideSearch
              keyboardTarget={canvas}
              vars={[
                {
                  nodeId: 'source',
                  title: 'Source',
                  vars: [
                    { variable: 'first', type: VarType.string },
                    { variable: 'second', type: VarType.string },
                  ],
                },
              ]}
              onChange={(value) => setSelected(value)}
            />
          )}
        </WorkflowCanvas>
      </div>
      <output aria-label="Selected variable">{selected.join('.')}</output>
    </>
  )
}

it('selects a connection variable before node movement handles the focused node keys', async () => {
  // Real handle dragging preserves node focus; React capture must not move that node before the picker sees its keys.
  await page.viewport(1000, 700)
  const screen = await render(
    <>
      <VariableConnectionCanvas />
      <textarea aria-label="Outside variable picker" />
    </>,
  )

  const source = screen.getByTestId('rf__node-source')
  await source.click()
  await userEvent.dragAndDrop(
    screen.getByTestId('source-source'),
    screen.getByTestId('target-assigner'),
    { steps: 5 },
  )
  await expect.element(screen.getByText('first', { exact: true })).toBeVisible()
  await expect.element(source).toHaveFocus()
  const sourcePosition = source.element().getBoundingClientRect()

  await userEvent.keyboard('{ArrowDown}')
  await userEvent.keyboard('{Enter}')

  await expect
    .element(screen.getByRole('status', { name: 'Selected variable' }))
    .toHaveTextContent('source.second')
  expect(source.element().getBoundingClientRect().x).toBe(sourcePosition.x)
  expect(source.element().getBoundingClientRect().y).toBe(sourcePosition.y)

  const outside = screen.getByRole('textbox', { name: 'Outside variable picker' })
  await outside.click()
  await userEvent.keyboard('top{Enter}bottom{Home}{ArrowUp}x')
  await expect.element(outside).toHaveValue('xtop\nbottom')
  await expect
    .element(screen.getByRole('status', { name: 'Selected variable' }))
    .toHaveTextContent('source.second')
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
