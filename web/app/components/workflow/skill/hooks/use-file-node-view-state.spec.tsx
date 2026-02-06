import { renderHook, waitFor } from '@testing-library/react'
import { useFileNodeViewState } from './use-file-node-view-state'

type HookProps = {
  fileTabId: string | null
  hasCurrentFileNode: boolean
  isNodeMapLoading: boolean
  isNodeMapFetching: boolean
  isNodeMapFetched: boolean
}

const createProps = (overrides: Partial<HookProps> = {}): HookProps => ({
  fileTabId: 'file-1',
  hasCurrentFileNode: false,
  isNodeMapLoading: true,
  isNodeMapFetching: true,
  isNodeMapFetched: false,
  ...overrides,
})

describe('useFileNodeViewState', () => {
  describe('resolution lifecycle', () => {
    it('should return ready when there is no active file tab', () => {
      const { result } = renderHook(() => useFileNodeViewState(createProps({
        fileTabId: null,
      })))

      expect(result.current).toBe('ready')
    })

    it('should return resolving during initial node resolution', () => {
      const { result } = renderHook(() => useFileNodeViewState(createProps()))

      expect(result.current).toBe('resolving')
    })

    it('should return missing when query settles without a matching node', () => {
      const { result, rerender } = renderHook(
        (props: HookProps) => useFileNodeViewState(props),
        { initialProps: createProps() },
      )

      rerender(createProps({
        isNodeMapLoading: false,
        isNodeMapFetching: false,
        isNodeMapFetched: true,
      }))

      expect(result.current).toBe('missing')
    })

    it('should stay missing during background refetch after missing is resolved', async () => {
      const { result, rerender } = renderHook(
        (props: HookProps) => useFileNodeViewState(props),
        { initialProps: createProps() },
      )

      rerender(createProps({
        isNodeMapLoading: false,
        isNodeMapFetching: false,
        isNodeMapFetched: true,
      }))

      await waitFor(() => {
        expect(result.current).toBe('missing')
      })

      rerender(createProps({
        isNodeMapLoading: false,
        isNodeMapFetching: true,
        isNodeMapFetched: true,
      }))

      expect(result.current).toBe('missing')
    })

    it('should become ready once the target node appears', () => {
      const { result, rerender } = renderHook(
        (props: HookProps) => useFileNodeViewState(props),
        { initialProps: createProps() },
      )

      rerender(createProps({
        hasCurrentFileNode: true,
        isNodeMapLoading: false,
        isNodeMapFetching: false,
        isNodeMapFetched: true,
      }))

      expect(result.current).toBe('ready')
    })

    it('should reset to resolving when switching to another file tab', () => {
      const { result, rerender } = renderHook(
        (props: HookProps) => useFileNodeViewState(props),
        { initialProps: createProps({
          isNodeMapLoading: false,
          isNodeMapFetching: false,
          isNodeMapFetched: true,
        }) },
      )

      expect(result.current).toBe('missing')

      rerender(createProps({
        fileTabId: 'file-2',
        isNodeMapLoading: false,
        isNodeMapFetching: true,
        isNodeMapFetched: true,
      }))

      expect(result.current).toBe('resolving')
    })
  })
})
