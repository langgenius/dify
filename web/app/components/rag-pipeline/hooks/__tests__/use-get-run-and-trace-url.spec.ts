import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { useGetRunAndTraceUrl } from '../use-get-run-and-trace-url'

it('builds run and trace URLs for the editor pipeline and requested run', () => {
  const { result } = renderHook(() => useGetRunAndTraceUrl(), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-test-123' },
  })
  for (const runId of ['run-abc', 'run-def']) {
    expect(result.current.getWorkflowRunAndTraceUrl(runId)).toEqual({
      runUrl: `/rag/pipelines/pipeline-test-123/workflow-runs/${runId}`,
      traceUrl: `/rag/pipelines/pipeline-test-123/workflow-runs/${runId}/node-executions`,
    })
  }
})
