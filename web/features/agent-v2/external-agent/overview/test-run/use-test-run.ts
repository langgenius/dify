import type { ExternalAgentOverviewPreview } from '../../preview'
import type { TestAgentAttachment } from './attachments'
import { useEffect, useRef, useState } from 'react'

export type TestAgentRunOutcome = 'succeeded' | 'failed'

export type TestAgentRun = {
  task: string
  attachments: TestAgentAttachment[]
  status: 'running' | 'stopping' | 'stopped' | TestAgentRunOutcome
  tracing: boolean
  response: string
  elapsedSeconds: number
  totalTokens: number | null
  traceSteps: ExternalAgentOverviewPreview['sampleTraceSteps']
}

export type TestAgentResultTab = 'result' | 'tracing'

const MOCK_RUN_DURATION_MS = 5_000
const MOCK_TRACE_DELAY_MS = 800
const MOCK_STOP_DURATION_MS = 2_000

// The panel root owns this local preview so closing its content does not stop a test.
export function useTestAgentRun({
  sampleResponse,
  sampleTraceSteps,
  tracing,
  sampleOutcome = 'succeeded',
  onCompleted,
}: Pick<ExternalAgentOverviewPreview, 'sampleResponse' | 'sampleTraceSteps' | 'tracing'> & {
  sampleOutcome?: TestAgentRunOutcome
  onCompleted: (outcome: TestAgentRunOutcome) => void
}) {
  const [run, setRun] = useState<TestAgentRun | null>(null)
  const [tab, setTab] = useState<TestAgentResultTab>('result')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const traceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAtRef = useRef(0)
  const onCompletedRef = useRef(onCompleted)

  // Completion must observe the current panel visibility, even after closing/reopening.
  useEffect(() => {
    onCompletedRef.current = onCompleted
  }, [onCompleted])

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      if (traceTimerRef.current !== null) clearTimeout(traceTimerRef.current)
    },
    [],
  )

  function startRun(task: string, attachments: TestAgentAttachment[]) {
    if (timerRef.current !== null || !task.trim()) return

    startedAtRef.current = Date.now()
    const nextRun: TestAgentRun = {
      task,
      attachments,
      status: 'running',
      tracing,
      response: sampleResponse,
      elapsedSeconds: 0,
      totalTokens: 0,
      traceSteps: [],
    }
    setRun(nextRun)
    setTab(tracing ? 'tracing' : 'result')
    if (tracing) {
      traceTimerRef.current = setTimeout(() => {
        traceTimerRef.current = null
        setRun((current) =>
          current?.status === 'running'
            ? { ...current, traceSteps: sampleTraceSteps.slice(0, 1) }
            : current,
        )
      }, MOCK_TRACE_DELAY_MS)
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setRun({
        ...nextRun,
        status: sampleOutcome,
        elapsedSeconds: MOCK_RUN_DURATION_MS / 1_000,
        totalTokens: 1_240,
        traceSteps: tracing ? sampleTraceSteps : [],
      })
      setTab('result')
      onCompletedRef.current(sampleOutcome)
    }, MOCK_RUN_DURATION_MS)
  }

  function clearTimers() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (traceTimerRef.current !== null) {
      clearTimeout(traceTimerRef.current)
      traceTimerRef.current = null
    }
  }

  function stopRun() {
    if (run?.status !== 'running') return
    clearTimers()
    setRun({ ...run, status: 'stopping' })
    setTab(run.tracing ? 'tracing' : 'result')
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setRun({
        ...run,
        status: 'stopped',
        elapsedSeconds: (Date.now() - startedAtRef.current) / 1_000,
        totalTokens: null,
      })
    }, MOCK_STOP_DURATION_MS)
  }

  function resetRun() {
    clearTimers()
    setRun(null)
  }

  return { run, tab, setTab, startRun, stopRun, resetRun }
}
