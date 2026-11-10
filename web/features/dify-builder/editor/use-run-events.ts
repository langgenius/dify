import type { NativeCanvasPath } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { SessionRunEvents } from '../session/types'
import type { BuilderRun } from './run-projection'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'
import { useQueryClient } from '@tanstack/react-query'
import { pick } from 'es-toolkit/object'
import { useSetAtom } from 'jotai'
import { useCallback, useMemo, useRef } from 'react'
import { useStoreApi } from 'reactflow'
import { createRunningWorkflowState } from '@/app/components/workflow-app/hooks/use-workflow-run-utils'
import { useWorkflowAppStore as useWorkflowStore } from '@/app/components/workflow-app/store/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { requestErrorMessage } from '../session/errors'
import { difyBuilderRunRestoreErrorAtom } from '../state'
import { getHistoricalRun, projectNativeCanvasEdges } from './run-projection'
import { useWorkflowEventDispatch } from './use-workflow-event-dispatch'

type ObservedRun = BuilderRun & {
  source: 'live' | 'history'
  complete: boolean
  interrupted?: boolean
  restoring?: boolean
}
type CanvasRunState = {
  nodes: Map<string, Partial<Node['data']>>
  edges: Map<string, Partial<NonNullable<Edge['data']>>>
}
type NativeCanvasObservation = { sessionId: string; version: number; path: NativeCanvasPath }

export const useDifyBuilderRunEvents = (appId?: string) => {
  const canvas = useStoreApi()
  const workflow = useWorkflowStore()
  const queryClient = useQueryClient()
  const setRestoreError = useSetAtom(difyBuilderRunRestoreErrorAtom)
  const dispatch = useWorkflowEventDispatch()
  const runRef = useRef<ObservedRun | null>(null)
  const requestIdRef = useRef(0)
  const canvasRunRef = useRef<CanvasRunState | null>(null)
  const nativeCanvasRef = useRef<NativeCanvasObservation | null>(null)

  const paintNativeCanvas = useCallback(
    (path: NativeCanvasPath) => {
      const { edges, setEdges } = canvas.getState()
      const projected = projectNativeCanvasEdges(edges as Edge[], path)
      if (projected !== edges) setEdges(projected)
    },
    [canvas],
  )

  const onNativeCanvasPath = useCallback(
    (sessionId: string, version: number, path: NativeCanvasPath) => {
      const current = nativeCanvasRef.current
      if (
        current?.sessionId === sessionId &&
        (current.path.native_run_id === path.native_run_id
          ? current.path.revision >= path.revision
          : current.version > version)
      )
        return
      nativeCanvasRef.current = { sessionId, version, path }
      const displayed = workflow.getState().workflowRunningData?.result.id
      const run = runRef.current
      if (
        !displayed ||
        displayed === path.native_run_id ||
        (run?.sessionId === sessionId && run.runId === displayed)
      )
        paintNativeCanvas(path)
    },
    [paintNativeCanvas, workflow],
  )

  const captureCanvasRun = useCallback(() => {
    const { getNodes, edges } = canvas.getState()
    canvasRunRef.current = {
      nodes: new Map(
        (getNodes() as Node[]).map((node) => [
          node.id,
          pick(node.data, [
            '_runningStatus',
            '_waitingRun',
            '_runningBranchId',
            '_retryIndex',
            '_iterationIndex',
            '_iterationLength',
            '_loopIndex',
            '_loopLength',
          ]),
        ]),
      ),
      edges: new Map(
        (edges as Edge[]).map((edge) => [
          edge.id,
          edge.data
            ? pick(edge.data, ['_sourceRunningStatus', '_targetRunningStatus', '_waitingRun'])
            : {},
        ]),
      ),
    }
  }, [canvas])

  const clearCanvasRun = useCallback(
    (onlyUnfinished = false) => {
      const unfinished = (status?: NodeRunningStatus) =>
        status === NodeRunningStatus.Running ||
        status === NodeRunningStatus.Retry ||
        status === NodeRunningStatus.Waiting
      const { getNodes, setNodes, edges, setEdges } = canvas.getState()
      setNodes(
        (getNodes() as Node[]).map((node) => ({
          ...node,
          data: {
            ...node.data,
            _runningStatus:
              onlyUnfinished && !unfinished(node.data._runningStatus)
                ? node.data._runningStatus
                : undefined,
            _waitingRun: false,
            _runningBranchId: onlyUnfinished ? node.data._runningBranchId : undefined,
            _retryIndex: undefined,
            _iterationIndex: undefined,
            _iterationLength: undefined,
            _loopIndex: undefined,
            _loopLength: undefined,
          },
        })),
      )
      setEdges(
        (edges as Edge[]).map((edge) => ({
          ...edge,
          data: {
            ...edge.data,
            _sourceRunningStatus:
              onlyUnfinished && !unfinished(edge.data?._sourceRunningStatus)
                ? edge.data?._sourceRunningStatus
                : undefined,
            _targetRunningStatus:
              onlyUnfinished && !unfinished(edge.data?._targetRunningStatus)
                ? edge.data?._targetRunningStatus
                : undefined,
            _waitingRun: false,
          },
        })),
      )
    },
    [canvas],
  )

  const onCanvasRefreshed = useCallback(() => {
    const run = runRef.current
    const saved = canvasRunRef.current
    const displayed = workflow.getState().workflowRunningData?.result.id
    const path = nativeCanvasRef.current?.path
    if (!run || !saved || displayed !== run.runId) {
      if (path && (!displayed || displayed === path.native_run_id)) paintNativeCanvas(path)
      return
    }
    const { getNodes, setNodes, edges, setEdges } = canvas.getState()
    setNodes(
      (getNodes() as Node[]).map((node) => ({
        ...node,
        data: { ...node.data, ...saved.nodes.get(node.id) },
      })),
    )
    const restored = (edges as Edge[]).map((edge) =>
      edge.data ? { ...edge, data: { ...edge.data, ...saved.edges.get(edge.id) } } : edge,
    )
    setEdges(
      path?.native_run_id === run.runId ? projectNativeCanvasEdges(restored, path) : restored,
    )
  }, [canvas, paintNativeCanvas, workflow])

  const reset = useCallback(() => {
    requestIdRef.current += 1
    setRestoreError('')
    const run = runRef.current
    const path = nativeCanvasRef.current?.path
    runRef.current = null
    canvasRunRef.current = null
    nativeCanvasRef.current = null
    const displayed = workflow.getState().workflowRunningData?.result.id
    if (displayed ? displayed !== run?.runId && displayed !== path?.native_run_id : !path) return
    workflow.setState({ workflowRunningData: undefined })
    clearCanvasRun()
  }, [clearCanvasRun, setRestoreError, workflow])

  const onWorkflowEvent = useCallback<SessionRunEvents['onWorkflowEvent']>(
    (event) => {
      const { payload } = event
      const current = runRef.current
      // Chatflow's text/message/error events omit the run ID. They belong to
      // the run started in this command, never a previous command's result.
      const runId =
        payload.workflow_run_id ??
        (current?.sessionId === event.session_id && current.atVersion === event.at_version
          ? current.runId
          : '')
      const resumesPausedRun =
        payload.event === 'workflow_started' &&
        current?.runId === runId &&
        workflow.getState().workflowRunningData?.result.status === 'paused'
      if (resumesPausedRun) {
        requestIdRef.current += 1
        setRestoreError('')
        runRef.current = {
          ...current,
          atVersion: event.at_version,
          source: 'live',
          complete: false,
          restoring: false,
        }
      } else if (
        payload.event === 'workflow_started' ||
        (payload.event === 'error' && current?.runId !== runId)
      ) {
        requestIdRef.current += 1
        setRestoreError('')
        canvasRunRef.current = null
        const native = nativeCanvasRef.current
        if (native?.sessionId !== event.session_id || native.path.native_run_id !== runId)
          nativeCanvasRef.current = null
        runRef.current = {
          sessionId: event.session_id,
          runId,
          atVersion: event.at_version,
          source: 'live',
          complete: false,
        }
        clearCanvasRun()
        const initial = createRunningWorkflowState()
        workflow.getState().setWorkflowRunningData({
          ...initial,
          result: { ...initial.result, id: runId },
        })
      }
      const run = runRef.current
      // A reconnect may join midway through a run. Restore that run from durable
      // history instead of invoking node callbacks without its started event.
      if (!run || run.source !== 'live' || run.runId !== runId) return
      const path = nativeCanvasRef.current?.path
      const previousEdges = canvas.getState().edges
      dispatch(payload)
      if (
        path?.native_run_id === runId &&
        (previousEdges !== canvas.getState().edges || payload.event === 'workflow_started')
      )
        paintNativeCanvas(path)
      if (
        payload.event === 'workflow_finished' ||
        payload.event === 'workflow_paused' ||
        payload.event === 'error'
      )
        run.complete = true
    },
    [canvas, clearCanvasRun, dispatch, paintNativeCanvas, setRestoreError, workflow],
  )

  const onStreamInterrupted = useCallback(() => {
    const run = runRef.current
    if (run?.source === 'live' && !run.complete) run.interrupted = true
  }, [])

  const onCanvasEvent = useCallback<SessionRunEvents['onCanvasEvent']>(
    (event) => {
      if (event.event === 'graph_changed' && event.cause === 'restore') reset()
      // Native workflow events own execution status; other canvas events
      // preserve the status of paused and partially successful runs.
    },
    [reset],
  )

  const restoreRun = useCallback<SessionRunEvents['restoreRun']>(
    (sessionId, items, view) => {
      const restored = getHistoricalRun(sessionId, items, view)
      const current = runRef.current
      const displayedResult = workflow.getState().workflowRunningData?.result
      const receipt = view?.test_execution
      const native = nativeCanvasRef.current
      const endedPausedRun =
        receipt?.status === 'terminal' &&
        receipt.native_run_id === displayedResult?.id &&
        displayedResult?.status === 'paused' &&
        receipt.native_status !== 'paused'
      if (
        !restored ||
        !appId ||
        (native?.sessionId === sessionId &&
          native.path.native_run_id !== restored.runId &&
          native.version > restored.atVersion) ||
        (current?.sessionId === sessionId &&
          (current.atVersion > restored.atVersion ||
            (current.runId === restored.runId &&
              ((current.complete && !current.interrupted && !endedPausedRun) ||
                current.restoring))))
      )
        return

      if (restored.canvasPath?.native_run_id === restored.runId)
        onNativeCanvasPath(sessionId, restored.atVersion, restored.canvasPath)

      const displayedRunId = displayedResult?.id
      const run: ObservedRun = { ...restored, source: 'history', complete: false, restoring: true }
      runRef.current = run
      const requestId = ++requestIdRef.current
      setRestoreError('')
      const input = { params: { app_id: appId, run_id: run.runId } }
      // These queries serve reopen/recovery only. A complete live stream never
      // reaches this branch, even when command reconciliation repeats its result card.
      void Promise.all([
        queryClient.query(
          consoleQuery.apps.byAppId.workflowRuns.byRunId.get.queryOptions({ input, staleTime: 0 }),
        ),
        queryClient.query(
          consoleQuery.apps.byAppId.workflowRuns.byRunId.nodeExecutions.get.queryOptions({
            input,
            staleTime: 0,
          }),
        ),
      ])
        .then(([detail, response]) => {
          if (requestIdRef.current !== requestId || runRef.current !== run) return
          const native = nativeCanvasRef.current
          if (
            native?.sessionId === sessionId &&
            native.path.native_run_id !== run.runId &&
            native.version > run.atVersion
          )
            return
          const executions = response.data ?? []
          const displayed = workflow.getState().workflowRunningData?.result.id
          if (displayed !== displayedRunId && displayed !== run.runId) return
          clearCanvasRun()
          const statuses = new Map(
            [...executions]
              .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
              .map((execution) => [
                execution.node_id,
                Object.values(NodeRunningStatus).find((status) => status === execution.status),
              ]),
          )
          const { getNodes, setNodes, edges, setEdges } = canvas.getState()
          setNodes(
            (getNodes() as Node[]).map((node) => ({
              ...node,
              data: { ...node.data, _runningStatus: statuses.get(node.id) },
            })),
          )
          const path = native?.path.native_run_id === run.runId ? native.path : null
          setEdges(
            path
              ? projectNativeCanvasEdges(edges as Edge[], path)
              : (edges as Edge[]).map((edge) => {
                  const executed = executions.some(
                    (execution) =>
                      execution.node_id === edge.target &&
                      execution.predecessor_node_id === edge.source,
                  )
                  return {
                    ...edge,
                    data: {
                      ...edge.data,
                      _sourceRunningStatus: executed ? statuses.get(edge.source) : undefined,
                      _targetRunningStatus: executed ? statuses.get(edge.target) : undefined,
                    },
                  }
                }),
          )
          workflow.getState().setWorkflowRunningData({
            result: {
              id: run.runId,
              status: detail.status ?? 'unknown',
              inputs: JSON.stringify(detail.inputs),
              inputs_truncated: false,
              process_data_truncated: false,
              outputs: JSON.stringify(detail.outputs),
              outputs_truncated: false,
              error: detail.error ?? undefined,
              elapsed_time: detail.elapsed_time ?? undefined,
              total_tokens: detail.total_tokens ?? undefined,
              total_steps: detail.total_steps ?? undefined,
            },
            tracing: executions as NodeTracing[],
          })
          run.complete =
            detail.status === 'succeeded' ||
            detail.status === 'failed' ||
            detail.status === 'stopped' ||
            detail.status === 'partial-succeeded'
          captureCanvasRun()
        })
        .catch(async (error: unknown) => {
          const message = await requestErrorMessage(error)
          if (requestIdRef.current === requestId && runRef.current === run) setRestoreError(message)
        })
        .finally(() => {
          run.restoring = false
        })
    },
    [
      appId,
      canvas,
      captureCanvasRun,
      clearCanvasRun,
      onNativeCanvasPath,
      queryClient,
      setRestoreError,
      workflow,
    ],
  )

  const finishCommand = useCallback(() => {
    const run = runRef.current
    if (
      !run ||
      run.source !== 'live' ||
      workflow.getState().workflowRunningData?.result.id !== run.runId
    )
      return
    if (!run.complete) {
      const data = workflow.getState().workflowRunningData!
      workflow.getState().setWorkflowRunningData({
        ...data,
        result: { ...data.result, status: 'unknown' },
        tracing: data.tracing?.map((trace) => ({
          ...trace,
          status: trace.status === 'running' || trace.status === 'retry' ? 'unknown' : trace.status,
        })),
      })
      clearCanvasRun(true)
    }
    captureCanvasRun()
  }, [captureCanvasRun, clearCanvasRun, workflow])

  return useMemo(
    () => ({
      onWorkflowEvent,
      onNativeCanvasPath,
      onStreamInterrupted,
      onCanvasEvent,
      restoreRun,
      finishCommand,
      reset,
      onCanvasRefreshed,
    }),
    [
      onWorkflowEvent,
      onNativeCanvasPath,
      onStreamInterrupted,
      onCanvasEvent,
      restoreRun,
      finishCommand,
      reset,
      onCanvasRefreshed,
    ],
  )
}
