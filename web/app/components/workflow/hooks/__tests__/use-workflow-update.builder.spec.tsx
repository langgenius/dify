import { act } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowUpdate } from '../use-workflow-update'

const mockEventEmit = vi.hoisted(() => vi.fn())

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: (...args: unknown[]) => mockEventEmit(...args),
    },
  }),
}))

describe('useWorkflowUpdate', () => {
  it('emits initialized data and only sets a valid viewport', () => {
    const { result } = renderWorkflowHook(() => useWorkflowUpdate())

    act(() => {
      result.current.handleUpdateWorkflowCanvas({
        nodes: [createNode({ id: 'n1' })],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 0.5 },
      })
      result.current.handleUpdateWorkflowCanvas({
        nodes: [],
        edges: [],
        viewport: { x: 'bad' } as never,
      })
    })

    expect(mockEventEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WORKFLOW_DATA_UPDATE',
        payload: expect.objectContaining({
          nodes: [
            expect.objectContaining({
              id: 'n1',
              data: expect.objectContaining({
                _connectedSourceHandleIds: [],
                _connectedTargetHandleIds: [],
              }),
            }),
          ],
        }),
      }),
    )
    expect(mockEventEmit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({ viewport: { x: 10, y: 20, zoom: 0.5 } }),
      }),
    )
    expect(mockEventEmit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({ viewport: undefined }),
      }),
    )
  })

  it('reports success only after the canvas acknowledges the update', () => {
    const { result } = renderWorkflowHook(() => useWorkflowUpdate())
    const graph = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    expect(result.current.handleUpdateWorkflowCanvas(graph)).toBe(false)
    mockEventEmit.mockImplementationOnce((event: { payload: { onApplied: () => void } }) =>
      event.payload.onApplied(),
    )
    expect(result.current.handleUpdateWorkflowCanvas(graph)).toBe(true)
  })

  it('preserves navigation while applying the initialized graph', () => {
    const { result } = renderWorkflowHook(() => useWorkflowUpdate())
    result.current.handleUpdateWorkflowCanvas(
      {
        nodes: [createNode({ id: 'generated' })],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 0.5 },
      },
      { preserveViewport: true },
    )
    expect(mockEventEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          nodes: [expect.objectContaining({ id: 'generated' })],
          viewport: undefined,
        }),
      }),
    )
  })
})
