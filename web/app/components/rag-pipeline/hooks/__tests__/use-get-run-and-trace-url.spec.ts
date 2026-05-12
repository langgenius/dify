import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGetRunAndTraceUrl } from '../use-get-run-and-trace-url'

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      pipelineId: 'pipeline-test-123',
    }),
  }),
}))

describe('useGetRunAndTraceUrl', () => {
  it('should return a function getWorkflowRunAndTraceUrl', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl())

    expect(typeof result.current.getWorkflowRunAndTraceUrl).toBe('function')
  })

  it('should generate correct runUrl', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl())
    const { runUrl } = result.current.getWorkflowRunAndTraceUrl('run-abc')

    expect(runUrl).toBe('/rag/pipelines/pipeline-test-123/workflow-runs/run-abc')
  })

  it('should generate correct traceUrl', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl())
    const { traceUrl } = result.current.getWorkflowRunAndTraceUrl('run-abc')

    expect(traceUrl).toBe('/rag/pipelines/pipeline-test-123/workflow-runs/run-abc/node-executions')
  })

  it('should handle different runIds', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl())

    const r1 = result.current.getWorkflowRunAndTraceUrl('id-1')
    const r2 = result.current.getWorkflowRunAndTraceUrl('id-2')

    expect(r1.runUrl).toContain('id-1')
    expect(r2.runUrl).toContain('id-2')
    expect(r1.runUrl).not.toBe(r2.runUrl)
  })
})
