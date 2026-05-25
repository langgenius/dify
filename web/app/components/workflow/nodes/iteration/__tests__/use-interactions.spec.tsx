import type { Node } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import {
  createIterationNode,
  createNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { ITERATION_PADDING } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { useNodeIterationInteractions } from '../use-interactions'

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesMetaData: () => ({
    nodesMap: {
      [BlockEnum.Code]: {
        defaultValue: {
          title: 'Code',
          desc: '',
        },
      },
    },
  }),
}))

vi.mock('@/app/components/workflow/utils', () => ({
  generateNewNode: (...args: unknown[]) => mockGenerateNewNode(...args),
  getNodeCustomTypeByNodeDataType: () => 'custom',
}))

describe('useNodeIterationInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expand the iteration node when children overflow the bounds', () => {
    mockGetNodes.mockReturnValue([
      createIterationNode({
        id: 'iteration-node',
        width: 120,
        height: 80,
        data: { width: 120, height: 80 },
      }),
      createNode({
        id: 'child-node',
        parentId: 'iteration-node',
        position: { x: 100, y: 90 },
        width: 60,
        height: 40,
      }),
    ])

    const { result } = renderHook(() => useNodeIterationInteractions())
    result.current.handleNodeIterationRerender('iteration-node')

    expect(mockSetNodes).toHaveBeenCalledTimes(1)
    const updatedNodes = mockSetNodes.mock.calls[0]![0]
    const updatedIterationNode = updatedNodes.find((node: Node) => node.id === 'iteration-node')
    expect(updatedIterationNode.width).toBe(100 + 60 + ITERATION_PADDING.right)
    expect(updatedIterationNode.height).toBe(90 + 40 + ITERATION_PADDING.bottom)
  })

  it('should restrict dragging to the iteration container padding', () => {
    mockGetNodes.mockReturnValue([
      createIterationNode({
        id: 'iteration-node',
        width: 200,
        height: 180,
        data: { width: 200, height: 180 },
      }),
    ])

    const { result } = renderHook(() => useNodeIterationInteractions())
    const dragResult = result.current.handleNodeIterationChildDrag(createNode({
      id: 'child-node',
      parentId: 'iteration-node',
      position: { x: -10, y: -5 },
      width: 80,
      height: 60,
      data: { type: BlockEnum.Code, title: 'Child', desc: '', isInIteration: true },
    }))

    expect(dragResult.restrictPosition).toEqual({
      x: ITERATION_PADDING.left,
      y: ITERATION_PADDING.top,
    })
  })

  it('should rerender the parent iteration node when a child size changes', () => {
    mockGetNodes.mockReturnValue([
      createIterationNode({
        id: 'iteration-node',
        width: 120,
        height: 80,
        data: { width: 120, height: 80 },
      }),
      createNode({
        id: 'child-node',
        parentId: 'iteration-node',
        position: { x: 100, y: 90 },
        width: 60,
        height: 40,
      }),
    ])

    const { result } = renderHook(() => useNodeIterationInteractions())
    result.current.handleNodeIterationChildSizeChange('child-node')

    expect(mockSetNodes).toHaveBeenCalledTimes(1)
  })

  it('should skip iteration rerender when the resized node has no parent', () => {
    mockGetNodes.mockReturnValue([
      createNode({
        id: 'standalone-node',
        data: { type: BlockEnum.Code, title: 'Standalone', desc: '' },
      }),
    ])

    const { result } = renderHook(() => useNodeIterationInteractions())
    result.current.handleNodeIterationChildSizeChange('standalone-node')

    expect(mockSetNodes).not.toHaveBeenCalled()
  })

  it('should copy iteration children and remap ids', () => {
    mockGetNodes.mockReturnValue([
      createIterationNode({ id: 'iteration-node' }),
      createNode({
        id: 'child-node',
        parentId: 'iteration-node',
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
        parentId: 'new-iteration',
        data: { type: BlockEnum.Code, title: 'blocks.code 3', desc: '', iteration_id: 'new-iteration' },
      }),
    })

    const { result } = renderHook(() => useNodeIterationInteractions())
    const copyResult = result.current.handleNodeIterationChildrenCopy('iteration-node', 'new-iteration', { existing: 'mapped' })

    expect(mockGenerateNewNode).toHaveBeenCalledWith(expect.objectContaining({
      type: 'custom',
      parentId: 'new-iteration',
    }))
    expect(copyResult.copyChildren).toHaveLength(1)
    expect(copyResult.newIdMapping).toEqual({
      'existing': 'mapped',
      'child-node': 'new-iterationgenerated0',
    })
  })
})
