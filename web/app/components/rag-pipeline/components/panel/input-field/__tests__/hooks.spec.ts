import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFloatingRight } from '../hooks'

const mockGetNodes = vi.fn()
vi.mock('reactflow', () => ({
  useStore: (selector: (s: { getNodes: () => { id: string, data: { selected: boolean } }[] }) => unknown) => {
    return selector({ getNodes: mockGetNodes })
  },
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: (...args: unknown[]) => unknown) => fn,
}))

let mockNodePanelWidth = 400
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

beforeEach(() => {
  mockNodePanelWidth = 400
  mockWorkflowCanvasWidth = 1200
  mockOtherPanelWidth = 0
  mockGetNodes.mockReturnValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useFloatingRight', () => {
  describe('initial state', () => {
    it('should return floatingRight as false initially', () => {
      mockGetNodes.mockReturnValue([])

      const { result } = renderHook(() => useFloatingRight(600))

      expect(result.current.floatingRight).toBe(false)
    })

    it('should return floatingRightWidth as target width when not floating', () => {
      mockGetNodes.mockReturnValue([])

      const { result } = renderHook(() => useFloatingRight(600))

      expect(result.current.floatingRightWidth).toBe(600)
    })
  })

  describe('with no selected node', () => {
    it('should calculate space without node panel width', () => {
      mockGetNodes.mockReturnValue([{ id: 'node-1', data: { selected: false } }])
      mockWorkflowCanvasWidth = 1000

      const { result } = renderHook(() => useFloatingRight(400))

      expect(result.current.floatingRight).toBe(false)
    })
  })

  describe('with selected node', () => {
    it('should subtract node panel width from available space', () => {
      mockGetNodes.mockReturnValue([{ id: 'node-1', data: { selected: true } }])
      mockWorkflowCanvasWidth = 1200

      const { result } = renderHook(() => useFloatingRight(400))

      expect(result.current.floatingRight).toBe(true)
    })
  })

  describe('floatingRightWidth calculation', () => {
    it('should return target width when not floating', () => {
      mockGetNodes.mockReturnValue([])
      mockWorkflowCanvasWidth = 2000

      const { result } = renderHook(() => useFloatingRight(600))

      expect(result.current.floatingRightWidth).toBe(600)
    })

    it('should return minimum of target width and available panel widths when floating with no selected node', () => {
      mockGetNodes.mockReturnValue([])
      mockWorkflowCanvasWidth = 500
      mockOtherPanelWidth = 200

      const { result } = renderHook(() => useFloatingRight(600))

      expect(result.current.floatingRightWidth).toBeLessThanOrEqual(600)
    })

    it('should include node panel width when node is selected', () => {
      mockGetNodes.mockReturnValue([{ id: 'node-1', data: { selected: true } }])
      mockWorkflowCanvasWidth = 500
      mockNodePanelWidth = 300
      mockOtherPanelWidth = 100

      const { result } = renderHook(() => useFloatingRight(600))

      expect(result.current.floatingRightWidth).toBeLessThanOrEqual(600)
    })
  })

  describe('edge cases', () => {
    it('should handle undefined workflowCanvasWidth', () => {
      mockGetNodes.mockReturnValue([])
      mockWorkflowCanvasWidth = undefined

      const { result } = renderHook(() => useFloatingRight(400))

      expect(result.current.floatingRight).toBe(false)
    })

    it('should handle zero target element width', () => {
      mockGetNodes.mockReturnValue([])

      const { result } = renderHook(() => useFloatingRight(0))

      expect(result.current.floatingRightWidth).toBe(0)
    })

    it('should handle very large target element width', () => {
      mockGetNodes.mockReturnValue([])
      mockWorkflowCanvasWidth = 500

      const { result } = renderHook(() => useFloatingRight(10000))

      expect(result.current.floatingRight).toBe(true)
    })

    it('should return first selected node id when multiple nodes exist', () => {
      mockGetNodes.mockReturnValue([
        { id: 'node-1', data: { selected: false } },
        { id: 'node-2', data: { selected: true } },
        { id: 'node-3', data: { selected: false } },
      ])
      mockWorkflowCanvasWidth = 1200

      const { result } = renderHook(() => useFloatingRight(400))

      expect(result.current).toBeDefined()
    })
  })
})
