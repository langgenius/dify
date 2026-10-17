import { act } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowUpdate } from '../use-workflow-update'

const mockSetViewport = vi.hoisted(() => vi.fn())
const mockEventEmit = vi.hoisted(() => vi.fn())

// Viewport animation is a browser boundary; graph initialization stays real.
vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useReactFlow: () => ({ setViewport: mockSetViewport }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: (...args: unknown[]) => mockEventEmit(...args),
    },
  }),
}))

describe('useWorkflowUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits initialized data and only sets a valid viewport', () => {
    const { result } = renderWorkflowHook(() => useWorkflowUpdate())

    act(() => {
      result.current.handleUpdateWorkflowCanvas({
        nodes: [createNode({ id: 'n1' })],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 0.5 },
      } as never)
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
    expect(mockSetViewport).toHaveBeenCalledTimes(1)
    expect(mockSetViewport).toHaveBeenCalledWith({ x: 10, y: 20, zoom: 0.5 })
  })
})
