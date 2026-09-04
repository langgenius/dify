'use client'

import type {
  NodeEventData,
  ProgressEventData,
  TraceStep,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderLiveProgress } from '../types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderLiveProgressAtom,
  difyBuilderSessionViewAtom,
} from './state'

const toLiveProgress = (progress: ProgressEventData): DifyBuilderLiveProgress => ({
  sessionId: progress.session_id,
  operationId: progress.operation_id,
  stageId: progress.stage_id,
  atVersion: progress.at_version,
  revision: progress.revision,
  trace: { ...progress.trace, steps: [...(progress.trace.steps ?? [])] },
})

const nodeStep = (node: NodeEventData): TraceStep => {
  const succeeded = node.status === 'success' || node.status === 'succeeded'
  const failed = node.status === 'failed'
  return {
    id: `node:${node.node_id}`,
    label: node.title || node.node_id,
    state: succeeded
      ? 'done'
      : failed
        ? 'stopped'
        : node.status === 'running'
          ? 'active'
          : 'pending',
    tone: failed ? 'error' : succeeded ? 'success' : 'neutral',
  }
}

/** Owns low-frequency, replaceable progress snapshots separately from SessionView. */
export const useDifyBuilderLiveProgress = () => {
  const store = useStore()
  const setLiveProgress = useSetAtom(difyBuilderLiveProgressAtom)
  const nodeRevisionsRef = useRef(new Map<string, number>())

  const clear = useCallback(() => {
    nodeRevisionsRef.current.clear()
    setLiveProgress(null)
  }, [setLiveProgress])

  const clearThroughVersion = useCallback(
    (sessionId: string, version: number) => {
      setLiveProgress((current) => {
        if (current?.sessionId === sessionId && current.atVersion <= version) {
          nodeRevisionsRef.current.clear()
          return null
        }
        return current
      })
    },
    [setLiveProgress],
  )

  const enqueue = useCallback(
    (progress: ProgressEventData) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== progress.session_id ||
        view?.session_id !== progress.session_id ||
        view.version >= progress.at_version
      )
        return

      let operationChanged = false
      setLiveProgress((current) => {
        if (current?.sessionId === progress.session_id && current.atVersion > progress.at_version)
          return current
        if (current?.operationId === progress.operation_id && current.revision >= progress.revision)
          return current
        const next = toLiveProgress(progress)
        if (
          current?.operationId !== progress.operation_id ||
          current.atVersion !== progress.at_version
        ) {
          operationChanged = true
          return next
        }

        const backendStepIds = new Set(next.trace.steps?.map((step) => step.id))
        const observedNodeSteps = current.trace.steps?.filter(
          (step) => step.id.startsWith('node:') && !backendStepIds.has(step.id),
        )
        if (!observedNodeSteps?.length) return next
        return {
          ...next,
          trace: { ...next.trace, steps: [...(next.trace.steps ?? []), ...observedNodeSteps] },
        }
      })
      if (operationChanged) nodeRevisionsRef.current.clear()
    },
    [setLiveProgress, store],
  )

  const enqueueNode = useCallback(
    (node: NodeEventData) => {
      const view = store.get(difyBuilderSessionViewAtom)
      if (
        store.get(difyBuilderActiveSessionIdAtom) !== node.session_id ||
        view?.session_id !== node.session_id ||
        view.version >= node.at_version
      )
        return

      const nextStep = nodeStep(node)
      const revisionKey = `${node.session_id}:${node.operation_id}:${node.node_id}`
      if ((nodeRevisionsRef.current.get(revisionKey) ?? 0) >= node.revision) return

      let accepted = false
      setLiveProgress((current) => {
        if (
          !current ||
          current.sessionId !== node.session_id ||
          current.operationId !== node.operation_id ||
          current.stageId !== node.stage_id ||
          current.atVersion !== node.at_version
        )
          return current
        accepted = true
        const steps = [...(current.trace.steps ?? [])]
        const stepIndex = steps.findIndex((step) => step.id === nextStep.id)
        if (stepIndex === -1) steps.push(nextStep)
        else steps[stepIndex] = nextStep
        return { ...current, trace: { ...current.trace, steps } }
      })
      if (accepted) nodeRevisionsRef.current.set(revisionKey, node.revision)
    },
    [setLiveProgress, store],
  )

  useEffect(() => clear, [clear])

  return useMemo(
    () => ({ clear, clearThroughVersion, enqueue, enqueueNode }),
    [clear, clearThroughVersion, enqueue, enqueueNode],
  )
}
