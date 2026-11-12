import type {
  WorkflowRunDetailResponse,
  WorkflowRunNodeExecutionResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { NodeTracing } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import { useStoreApi } from 'reactflow'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { consoleClient } from '@/service/console'

const POLL_INTERVAL = 1500
const activeStatuses = ['paused', 'running']

/** Bridges the asynchronous engine read model into the existing SSE-owned run store. */
export function useExternalWaitRun(
  appId: string,
  onCompleted: () => void,
  onSnapshot?: (
    run: WorkflowRunDetailResponse,
    executions: WorkflowRunNodeExecutionResponse[],
  ) => void,
) {
  const workflowStore = useWorkflowStore()
  const flowStore = useStoreApi()
  const discardRef = useRef<() => void>(() => {})
  const complete = useEffectEvent(onCompleted)
  const snapshot = useEffectEvent(
    (run: WorkflowRunDetailResponse, executions: WorkflowRunNodeExecutionResponse[]) =>
      onSnapshot?.(run, executions),
  )

  useEffect(() => {
    let disposed = false
    let session = 0
    let activeRunId: string | undefined
    let ignoredRunId: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const isCurrent = (runId: string, token: number) => {
      const current = workflowStore.getState().workflowRunningData?.result
      return (
        !disposed &&
        token === session &&
        runId !== ignoredRunId &&
        current?.id === runId &&
        activeStatuses.includes(current.status)
      )
    }

    const applySnapshot = (
      run: WorkflowRunDetailResponse,
      executions: WorkflowRunNodeExecutionResponse[],
    ) => {
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()
      if (!workflowRunningData || !run.status) return
      const previous = new Map(
        workflowRunningData.tracing?.map((execution) => [execution.id, execution]),
      )
      // NodeTracing is the existing presentation model for both SSE and generated read responses.
      const tracing = executions.map(
        (execution) => ({ ...previous.get(execution.id), ...execution }) as NodeTracing,
      )
      const humanInputWait = executions.some(
        (execution) => execution.status === 'paused' && execution.node_type === 'human-input',
      )
      setWorkflowRunningData(
        produce(workflowRunningData, (draft) => {
          draft.result = {
            ...draft.result,
            status: run.status!,
            outputs: typeof run.outputs === 'string' ? run.outputs : JSON.stringify(run.outputs),
            error: run.error ?? undefined,
            elapsed_time: run.elapsed_time ?? undefined,
            total_tokens: run.total_tokens ?? undefined,
            total_steps: run.total_steps ?? undefined,
            finished_at: run.finished_at ?? undefined,
            exceptions_count: run.exceptions_count ?? undefined,
            external_wait: run.status === 'paused',
            human_input_wait: humanInputWait,
            // The existing result renderer consumes grouped files, also produced by the SSE owner.
            files: getFilesInLogs(run.outputs) as unknown as typeof draft.result.files,
          }
          draft.tracing = tracing
          if (run.outputs && typeof run.outputs === 'object' && !Array.isArray(run.outputs)) {
            const values = Object.values(run.outputs)
            if (values.length === 1 && typeof values[0] === 'string') {
              draft.resultText = values[0]
              draft.resultTabActive = true
            }
          }
        }),
      )
      const byNode = new Map(
        executions
          .filter((execution) => execution.node_id)
          .map((execution) => [execution.node_id, execution]),
      )
      const { getNodes, setNodes } = flowStore.getState()
      setNodes(
        produce(getNodes(), (nodes) => {
          for (const node of nodes) {
            const execution = byNode.get(node.id)
            if (
              execution?.status &&
              Object.values(NodeRunningStatus).includes(execution.status as NodeRunningStatus)
            )
              node.data._runningStatus = execution.status as NodeRunningStatus
          }
        }),
      )
    }

    const read = async (runId: string, token: number) => {
      try {
        const run = await consoleClient.apps.byAppId.workflowRuns.byRunId.get({
          params: { app_id: appId, run_id: runId },
        })
        if (!isCurrent(runId, token)) return
        const executions = await consoleClient.apps.byAppId.workflowRuns.byRunId.nodeExecutions.get(
          { params: { app_id: appId, run_id: runId } },
        )
        if (!isCurrent(runId, token)) return
        applySnapshot(run, executions.data)
        snapshot(run, executions.data)
        if (run.status && !activeStatuses.includes(run.status)) {
          activeRunId = undefined
          complete()
          return
        }
      } catch {
        // Keep the authoritative paused/running state. The transport reports read failures.
        // A transient read failure must never retry the execution POST.
      }
      if (isCurrent(runId, token)) timer = setTimeout(() => void read(runId, token), POLL_INTERVAL)
    }

    const synchronize = () => {
      const result = workflowStore.getState().workflowRunningData?.result
      if (result?.id && result.id === ignoredRunId) return
      if (result && result.id === activeRunId && activeStatuses.includes(result.status)) return
      if (activeRunId) {
        session++
        activeRunId = undefined
        clearTimeout(timer)
      }
      if (
        result?.id &&
        result.external_wait &&
        !result.human_input_wait &&
        activeStatuses.includes(result.status)
      ) {
        activeRunId = result.id
        void read(result.id, ++session)
      }
    }
    discardRef.current = () => {
      ignoredRunId = workflowStore.getState().workflowRunningData?.result.id
      session++
      activeRunId = undefined
      clearTimeout(timer)
    }
    const unsubscribe = workflowStore.subscribe(synchronize)
    synchronize()
    return () => {
      disposed = true
      session++
      clearTimeout(timer)
      unsubscribe()
      discardRef.current = () => {}
    }
  }, [appId, flowStore, workflowStore])
  return useCallback(() => discardRef.current(), [])
}
