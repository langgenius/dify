import { renderHook } from '@testing-library/react'
import { useFloatingRight } from '../hooks'

const mockGetNodes = vi.fn()
vi.mock('reactflow', () => ({
  useStore: (
    selector: (s: { getNodes: () => { id: string; data: { selected: boolean } }[] }) => unknown,
  ) => {
    return selector({ getNodes: mockGetNodes })
  },
}))

const mockNodePanelWidth = 400
let mockWorkflowCanvasWidth: number | undefined = 1200
let mockOtherPanelWidth = 0

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    return selector({
      nodePanelWidth: mockNodePanelWidth,
      workflowCanvasWidth: mockWorkflowCanvasWidth,
      otherPanelWidth: mockOtherPanelWidth,
    })
  },
}))

it.each([
  { selected: false, canvas: 1008, other: 0, target: 600, floating: false, width: 600 },
  { selected: false, canvas: 1007, other: 0, target: 600, floating: true, width: 0 },
  { selected: true, canvas: 1200, other: 0, target: 400, floating: true, width: 400 },
  { selected: false, canvas: 500, other: 200, target: 600, floating: true, width: 200 },
  { selected: true, canvas: 500, other: 100, target: 600, floating: true, width: 500 },
  { selected: false, canvas: undefined, other: 0, target: 400, floating: false, width: 400 },
])(
  'positions the input panel for canvas=$canvas selected=$selected other=$other',
  ({ selected, canvas, other, target, floating, width }) => {
    mockGetNodes.mockReturnValue([{ id: 'node-1', data: { selected } }])
    mockWorkflowCanvasWidth = canvas
    mockOtherPanelWidth = other
    const { result } = renderHook(() => useFloatingRight(target))
    expect(result.current).toEqual({ floatingRight: floating, floatingRightWidth: width })
  },
)

it('stops floating when resizing leaves enough room beside the selected node', () => {
  mockGetNodes.mockReturnValue([{ id: 'node-1', data: { selected: true } }])
  mockWorkflowCanvasWidth = 1200
  mockOtherPanelWidth = 0
  const { result, rerender } = renderHook(() => useFloatingRight(600))
  expect(result.current).toEqual({ floatingRight: true, floatingRightWidth: 400 })
  mockWorkflowCanvasWidth = 1600
  rerender()
  expect(result.current).toEqual({ floatingRight: false, floatingRightWidth: 600 })
})
