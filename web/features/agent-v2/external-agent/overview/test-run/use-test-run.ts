import type { ExternalAgentOverviewPreview } from '../../preview'
import type { TestAgentAttachment } from './attachments'
import { useEffect, useRef, useState } from 'react'

export type TestAgentRun = {
  task: string
  attachments: TestAgentAttachment[]
  status: 'running' | 'succeeded'
  tracing: boolean
  response: string
  elapsedSeconds: number
  totalTokens: number
  traceSteps: ExternalAgentOverviewPreview['sampleTraceSteps']
}

export type TestAgentResultTab = 'result' | 'tracing'

const MOCK_RUN_DURATION_MS = 5_000

// The panel root owns this local preview so closing its content does not stop a test.
export function useTestAgentRun({
  sampleResponse,
  sampleTraceSteps,
  tracing,
}: Pick<ExternalAgentOverviewPreview, 'sampleResponse' | 'sampleTraceSteps' | 'tracing'>) {
  const [run, setRun] = useState<TestAgentRun | null>(null)
  const [tab, setTab] = useState<TestAgentResultTab>('result')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  function startRun(task: string, attachments: TestAgentAttachment[]) {
    if (timerRef.current !== null || !task.trim()) return

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
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setRun({
        ...nextRun,
        status: 'succeeded',
        elapsedSeconds: MOCK_RUN_DURATION_MS / 1_000,
        totalTokens: 1_240,
        traceSteps: tracing ? sampleTraceSteps : [],
      })
      setTab('result')
    }, MOCK_RUN_DURATION_MS)
  }

  function resetRun() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setRun(null)
  }

  return { run, tab, setTab, startRun, resetRun }
}
