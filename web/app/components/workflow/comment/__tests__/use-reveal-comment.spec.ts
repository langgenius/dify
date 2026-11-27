import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { act, waitFor } from '@testing-library/react'
import { useReactFlow, useStoreApi } from 'reactflow'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { useRevealComment } from '../use-reveal-comment'

const mockDirection = vi.hoisted(() => ({ value: 'ltr' as 'ltr' | 'rtl' }))
vi.mock('@langgenius/dify-ui/direction-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@langgenius/dify-ui/direction-provider')>()),
  useDirection: () => mockDirection.value,
}))

const commentAt = (id: string, position_x: number): WorkflowCommentBasic => ({
  id,
  position_x,
  position_y: 20,
  content: id,
  created_by: 'user-1',
  created_by_account: { id: 'user-1', name: 'Alice', email: 'alice@example.com', avatar_url: null },
  created_at: 1,
  updated_at: 1,
  resolved: false,
  mention_count: 0,
  reply_count: 0,
  participants: [],
})

// Canvas 1000×800 at zoom 2 shifted by (80, 160); the side panels take 200px.
const renderReveal = () => {
  const result = renderWorkflowFlowHook(
    () => ({ reveal: useRevealComment(), flow: useReactFlow(), flowStore: useStoreApi() }),
    {
      initialStoreState: {
        rightPanelWidth: 200,
        pendingComment: { x: 1, y: 2 },
      },
      reactFlowProps: { fitView: false, defaultViewport: { x: 80, y: 160, zoom: 2 } },
    },
  )
  act(() => result.result.current.flowStore.setState({ width: 1000, height: 800 }))
  return result
}

describe('useRevealComment', () => {
  beforeEach(() => {
    mockDirection.value = 'ltr'
  })

  it('selects the comment and leaves the canvas still when its marker is in view', async () => {
    const { result, store } = renderReveal()
    act(() => result.current.reveal(commentAt('in-view', 100)))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(store.getState()).toMatchObject({ activeCommentId: 'in-view', pendingComment: null })
    expect(result.current.flow.getViewport()).toEqual({ x: 80, y: 160, zoom: 2 })
  })

  it('centers a marker out of view in the area the panels leave visible, keeping the zoom', async () => {
    const { result } = renderReveal()
    act(() => result.current.reveal(commentAt('far', 2000)))

    await waitFor(() =>
      expect(result.current.flow.getViewport()).toEqual({ x: 400 - 4000, y: 400 - 40, zoom: 2 }),
    )
  })

  it('treats the panels as covering the left of the canvas in RTL', async () => {
    mockDirection.value = 'rtl'
    // At x 50 the marker is visible in LTR but under the panels in RTL.
    const { result } = renderReveal()
    act(() => result.current.reveal(commentAt('under-panels', 50)))

    await waitFor(() =>
      expect(result.current.flow.getViewport()).toEqual({ x: 600 - 100, y: 400 - 40, zoom: 2 }),
    )
  })
})
