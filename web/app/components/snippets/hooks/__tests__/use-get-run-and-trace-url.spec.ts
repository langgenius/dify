import { renderHook } from '@testing-library/react'
import { useGetRunAndTraceUrl } from '../use-get-run-and-trace-url'

describe('useGetRunAndTraceUrl', () => {
  it('should build snippet workflow run and trace urls from the snippet id', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl('snippet-1'))

    expect(result.current.getWorkflowRunAndTraceUrl('run-1')).toEqual({
      runUrl: '/snippets/snippet-1/workflow-runs/run-1',
      traceUrl: '/snippets/snippet-1/workflow-runs/run-1/node-executions',
    })
  })

  it('should return empty urls when no run id is provided', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl('snippet-1'))

    expect(result.current.getWorkflowRunAndTraceUrl()).toEqual({
      runUrl: '',
      traceUrl: '',
    })
  })
})
