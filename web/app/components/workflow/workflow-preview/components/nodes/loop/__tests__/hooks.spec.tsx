import type { Node } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { createLoopNode, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { LOOP_PADDING } from '@/app/components/workflow/constants'
import { useNodeLoopInteractions } from '../hooks'

const mockGetNodes = vi.hoisted(() => vi.fn())
const mockSetNodes = vi.hoisted(() => vi.fn())

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
    }),
  }),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

describe('workflow preview loop interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expands the loop node when children overflow the current bounds', () => {
    mockGetNodes.mockReturnValue([
      createLoopNode({
        id: 'loop-node',
        width: 120,
        height: 80,
        data: { width: 120, height: 80 },
      }),
      createNode({
        id: 'child-node',
        parentId: 'loop-node',
        position: { x: 100, y: 90 },
        width: 60,
        height: 40,
      }),
    ])

    const { result } = renderHook(() => useNodeLoopInteractions())
    result.current.handleNodeLoopRerender('loop-node')

    expect(mockSetNodes).toHaveBeenCalledTimes(1)
    const updatedLoopNode = mockSetNodes.mock.calls[0]![0].find((node: Node) => node.id === 'loop-node')
    expect(updatedLoopNode.width).toBe(100 + 60 + LOOP_PADDING.right)
    expect(updatedLoopNode.height).toBe(90 + 40 + LOOP_PADDING.bottom)
  })
})
