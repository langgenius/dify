import type { Node } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import {
  createLoopNode,
  createNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { LOOP_PADDING } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { useNodeLoopInteractions } from '../use-interactions'

const mockGetNodes = vi.hoisted(() => vi.fn())
const mockSetNodes = vi.hoisted(() => vi.fn())
const mockGenerateNewNode = vi.hoisted(() => vi.fn())

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useStoreApi: () => ({
      getState: () => ({
        getNodes: mockGetNodes,
        setNodes: mockSetNodes,
      }),
    }),
  }
})

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesMetaData: () => ({
    nodesMap: {
      [BlockEnum.Code]: {
        defaultValue: {
          title: 'Code',
        },
      },
    },
  }),
}))

vi.mock('@/app/components/workflow/utils', () => ({
  generateNewNode: (...args: unknown[]) => mockGenerateNewNode(...args),
  getNodeCustomTypeByNodeDataType: () => 'custom',
}))

describe('useNodeLoopInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expand the loop node when children overflow the bounds', () => {
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
    const updatedNodes = mockSetNodes.mock.calls[0]![0]
    const updatedLoopNode = updatedNodes.find((node: Node) => node.id === 'loop-node')
    expect(updatedLoopNode.width).toBe(100 + 60 + LOOP_PADDING.right)
    expect(updatedLoopNode.height).toBe(90 + 40 + LOOP_PADDING.bottom)
  })

  it('should restrict dragging to the loop container padding', () => {
    mockGetNodes.mockReturnValue([
      createLoopNode({
        id: 'loop-node',
        width: 200,
        height: 180,
        data: { width: 200, height: 180 },
      }),
    ])

    const { result } = renderHook(() => useNodeLoopInteractions())
    const dragResult = result.current.handleNodeLoopChildDrag(createNode({
      id: 'child-node',
      parentId: 'loop-node',
      position: { x: -10, y: -5 },
      width: 80,
      height: 60,
      data: { type: BlockEnum.Code, title: 'Child', desc: '', isInLoop: true },
    }))

    expect(dragResult.restrictPosition).toEqual({
      x: LOOP_PADDING.left,
      y: LOOP_PADDING.top,
    })
  })

  it('should rerender the parent loop node when a child size changes', () => {
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
    result.current.handleNodeLoopChildSizeChange('child-node')

    expect(mockSetNodes).toHaveBeenCalledTimes(1)
  })

  it('should skip loop rerender when the resized node has no parent', () => {
    mockGetNodes.mockReturnValue([
      createNode({
        id: 'standalone-node',
        data: { type: BlockEnum.Code, title: 'Standalone', desc: '' },
      }),
    ])

    const { result } = renderHook(() => useNodeLoopInteractions())
    result.current.handleNodeLoopChildSizeChange('standalone-node')

    expect(mockSetNodes).not.toHaveBeenCalled()
  })

  it('should copy loop children and remap ids', () => {
    mockGetNodes.mockReturnValue([
      createLoopNode({ id: 'loop-node' }),
      createNode({
        id: 'child-node',
        parentId: 'loop-node',
        data: { type: BlockEnum.Code, title: 'Child', desc: '' },
      }),
      createNode({
        id: 'same-type-node',
        data: { type: BlockEnum.Code, title: 'Code', desc: '' },
      }),
    ])
    mockGenerateNewNode.mockReturnValue({
      newNode: createNode({
        id: 'generated',
        parentId: 'new-loop',
        data: { type: BlockEnum.Code, title: 'Code 3', desc: '', isInLoop: true, loop_id: 'new-loop' },
      }),
    })

    const { result } = renderHook(() => useNodeLoopInteractions())
    const copyResult = result.current.handleNodeLoopChildrenCopy('loop-node', 'new-loop', { existing: 'mapped' })

    expect(mockGenerateNewNode).toHaveBeenCalledWith(expect.objectContaining({
      type: 'custom',
      parentId: 'new-loop',
    }))
    expect(copyResult.copyChildren).toHaveLength(1)
    expect(copyResult.newIdMapping).toEqual({
      'existing': 'mapped',
      'child-node': 'new-loopgeneratednew-loop0',
    })
  })
})
