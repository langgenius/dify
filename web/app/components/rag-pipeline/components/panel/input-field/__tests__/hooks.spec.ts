import { act } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useFloatingRight } from '../hooks'

const renderFloatingRight = ({
  target,
  selected,
  canvas,
  other,
}: {
  target: number
  selected: boolean
  canvas: number | undefined
  other: number
}) =>
  renderWorkflowCanvasHook(() => useFloatingRight(target), {
    nodes: [createNode({ id: 'node-1', data: { selected } })],
    initialStoreState: {
      nodePanelWidth: 400,
      workflowCanvasWidth: canvas,
      otherPanelWidth: other,
    },
  })

it.each([
  { selected: false, canvas: 1008, other: 0, target: 600, floating: false, width: 600 },
  { selected: false, canvas: 1007, other: 0, target: 600, floating: true, width: 0 },
  { selected: true, canvas: 1200, other: 0, target: 400, floating: true, width: 400 },
  { selected: false, canvas: 500, other: 200, target: 600, floating: true, width: 200 },
  { selected: true, canvas: 500, other: 100, target: 600, floating: true, width: 500 },
  { selected: false, canvas: undefined, other: 0, target: 400, floating: false, width: 400 },
])(
  'positions the input panel for canvas=$canvas selected=$selected other=$other',
  ({ floating, width, ...scenario }) => {
    const { result } = renderFloatingRight(scenario)

    expect(result.current).toEqual({ floatingRight: floating, floatingRightWidth: width })
  },
)

it('stops floating when resizing leaves enough room beside the selected node', () => {
  const { result, store } = renderFloatingRight({
    target: 600,
    selected: true,
    canvas: 1200,
    other: 0,
  })
  expect(result.current).toEqual({ floatingRight: true, floatingRightWidth: 400 })

  act(() => store.setState({ workflowCanvasWidth: 1600 }))

  expect(result.current).toEqual({ floatingRight: false, floatingRightWidth: 600 })
})

it('reclaims the node panel space when the node is deselected', () => {
  const { result, setCanvas } = renderFloatingRight({
    target: 600,
    selected: true,
    canvas: 1200,
    other: 0,
  })
  expect(result.current.floatingRight).toBe(true)

  act(() => setCanvas({ nodes: [createNode({ id: 'node-1', data: { selected: false } })] }))

  expect(result.current).toEqual({ floatingRight: false, floatingRightWidth: 600 })
})
