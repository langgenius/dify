import type {
  ExternalTestPayload,
  ExternalTestStatusResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { ExternalAgentOverview } from '../../model'
import { hashKey, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'

export type TestAgentRunOutcome = 'succeeded' | 'failed'
export type TestAgentResultTab = 'result' | 'tracing'
type TestRequest = {
  body: ExternalTestPayload
  startedAt: number
  anchorId?: string
  unknown: boolean
  tracing: boolean
}
export type TestAgentRun = {
  result: ExternalTestStatusResponse | undefined
  status: 'running' | 'stopping' | 'stopped' | 'ended' | 'unknown' | TestAgentRunOutcome
  elapsedSeconds: number | null
  currentInvocationId: string | undefined
  tracing: boolean
}
const isTerminal = (state: string) => ['succeeded', 'failed', 'ended', 'stopped'].includes(state)
const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

export function useTestAgentPageSession(overview: ExternalAgentOverview) {
  const [pageSessionId, setPageSessionId] = useState(() => crypto.randomUUID())
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    let left = false
    const leavePage = () => {
      if (left) return
      left = true
      void consoleClient.externalAgentTests.leavePage
        .post(
          { body: { page_session_id: pageSessionId } },
          { context: { keepalive: true, silent: true } },
        )
        .catch(() => {
          // Leaving is best effort; server TTL owns eventual cleanup.
        })
    }
    const restorePage = (event: PageTransitionEvent) => {
      if (event.persisted) setPageSessionId(crypto.randomUUID())
    }
    window.addEventListener('pagehide', leavePage)
    window.addEventListener('pageshow', restorePage)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pagehide', leavePage)
      window.removeEventListener('pageshow', restorePage)
      // Strict Mode's setup/cleanup/setup is not a real page departure.
      queueMicrotask(() => {
        if (!mountedRef.current) leavePage()
      })
    }
  }, [overview.asset.id, overview.asset.tenant_id, pageSessionId])
  return pageSessionId
}

export function useTestAgentRun({
  overview,
  pageSessionId,
  onAccepted,
  onCompleted,
}: {
  overview: ExternalAgentOverview
  pageSessionId: string
  onAccepted: (leaseIds: string[]) => void
  onCompleted: (outcome: TestAgentRunOutcome) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const queryClient = useQueryClient()
  const [request, setRequest] = useState<TestRequest | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [tab, setTab] = useState<TestAgentResultTab>('result')
  const [completedAt, setCompletedAt] = useState<number | null>(null)
  const requestRef = useRef<TestRequest | null>(null)
  const submittingRef = useRef(false)
  const completedRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const generation = overview.asset.test_display_generation
  const identity = `${overview.asset.tenant_id}:${overview.asset.id}:${pageSessionId}:${generation}`
  const identityRef = useRef(identity)
  const onCompletedRef = useRef(onCompleted)
  useEffect(() => {
    identityRef.current = identity
    onCompletedRef.current = onCompleted
  }, [identity, onCompleted])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const activeRequest =
    request?.body.expected_generation === generation &&
    request.body.page_session_id === pageSessionId
      ? request
      : null
  const anchorId = activeRequest?.anchorId
  const start = useMutation(
    consoleQuery.externalAgents.byAgentId.tests.post.mutationOptions({ context: { silent: true } }),
  )
  const cancel = useMutation(
    consoleQuery.externalAgents.byAgentId.tests.byInvocationId.cancel.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const resultOptions = consoleQuery.externalAgents.byAgentId.tests.byInvocationId.get.queryOptions(
    {
      input: anchorId
        ? { params: { agent_id: overview.asset.id, invocation_id: anchorId } }
        : skipToken,
      context: { silent: true },
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchInterval: (query) =>
        query.state.error ||
        !query.state.data ||
        !['waiting', 'retry_pending'].includes(query.state.data.state)
          ? false
          : 1_500,
    },
  )
  const resultQuery = useQuery(resultOptions)
  const readStatus = getHttpErrorStatus(resultQuery.error)
  const invalid = readStatus !== undefined && [401, 403, 404, 409, 410].includes(readStatus)
  const result =
    activeRequest &&
    !invalid &&
    resultQuery.data?.metadata.test_generation === generation &&
    resultQuery.data.metadata.agent_id === overview.asset.id
      ? resultQuery.data
      : undefined
  const complete = useCallback(
    (response: ExternalTestStatusResponse, acceptedAnchor: string, observedAt: number) => {
      if (
        !isTerminal(response.state) ||
        response.metadata.test_generation !== generation ||
        response.metadata.agent_id !== overview.asset.id
      )
        return
      const completion = `${identity}:${acceptedAnchor}`
      if (completedRef.current === completion) return
      completedRef.current = completion
      setFailure(null)
      setCompletedAt(observedAt)
      setTab('result')
      if (response.state !== 'stopped')
        onCompletedRef.current(response.state === 'succeeded' ? 'succeeded' : 'failed')
    },
    [generation, identity, overview.asset.id],
  )
  const resultQueryHash = hashKey(resultOptions.queryKey)
  useEffect(() => {
    if (!anchorId) return
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type !== 'updated' ||
        event.query.queryHash !== resultQueryHash ||
        identity !== identityRef.current
      )
        return
      if (event.action.type === 'error') {
        const status = getHttpErrorStatus(event.action.error)
        if (status !== undefined && [401, 403, 404, 409, 410].includes(status)) {
          requestRef.current = null
          setRequest(null)
          setFailure(
            message(
              event.action.error,
              t(($) => $['external.overview.testRun.expired']),
            ),
          )
        }
      } else if (event.action.type === 'success') {
        const response = queryClient.getQueryData<ExternalTestStatusResponse>(event.query.queryKey)
        if (response) complete(response, anchorId, event.query.state.dataUpdatedAt)
      }
    })
  }, [anchorId, identity, queryClient, resultQueryHash, complete, t])

  async function submit(snapshot: TestRequest) {
    if (submittingRef.current) return
    submittingRef.current = true
    setFailure(null)
    const submittedIdentity = identity
    try {
      const response = await start.mutateAsync({
        params: { agent_id: overview.asset.id },
        body: snapshot.body,
      })
      if (
        !mountedRef.current ||
        submittedIdentity !== identityRef.current ||
        requestRef.current !== snapshot
      )
        return
      const accepted = { ...snapshot, anchorId: response.invocation_id, unknown: false }
      const options = consoleQuery.externalAgents.byAgentId.tests.byInvocationId.get.queryOptions({
        input: { params: { agent_id: overview.asset.id, invocation_id: response.invocation_id } },
      })
      queryClient.setQueryData(options.queryKey, response)
      onAccepted(snapshot.body.input_lease_ids ?? [])
      requestRef.current = accepted
      setRequest(accepted)
      complete(response, response.invocation_id, Date.now())
    } catch (error) {
      if (
        !mountedRef.current ||
        submittedIdentity !== identityRef.current ||
        requestRef.current !== snapshot
      )
        return
      const status = getHttpErrorStatus(error)
      const unknown = status === undefined || status === 408 || status >= 500
      const next = unknown ? { ...snapshot, unknown: true } : null
      requestRef.current = next
      setRequest(next)
      setFailure(
        message(
          error,
          t(($) => $['api.actionFailed'], { ns: 'common' }),
        ),
      )
    } finally {
      submittingRef.current = false
    }
  }
  function startRun(task: string, leaseIds: string[]) {
    if (
      submittingRef.current ||
      !task.trim() ||
      activeRequest?.unknown ||
      (result && !isTerminal(result.state))
    )
      return
    const snapshot: TestRequest = {
      body: {
        page_session_id: pageSessionId,
        expected_generation: generation,
        idempotency_key: crypto.randomUUID(),
        task_text: task,
        input_lease_ids: leaseIds,
      },
      startedAt: Date.now(),
      unknown: false,
      tracing: overview.tracing,
    }
    requestRef.current = snapshot
    setCompletedAt(null)
    setRequest(snapshot)
    setTab(overview.tracing ? 'tracing' : 'result')
    void submit(snapshot)
  }
  function recoverRequest() {
    if (activeRequest?.unknown) void submit(activeRequest)
  }
  function stopRun() {
    if (!result || isTerminal(result.state) || cancel.isPending) return
    const cancelIdentity = identity
    cancel.mutate(
      { params: { agent_id: overview.asset.id, invocation_id: result.invocation_id } },
      {
        onError(error) {
          if (!mountedRef.current || cancelIdentity !== identityRef.current) return
          setFailure(
            message(
              error,
              t(($) => $['api.actionFailed'], { ns: 'common' }),
            ),
          )
        },
        onSuccess() {
          if (mountedRef.current && cancelIdentity === identityRef.current)
            void resultQuery.refetch()
        },
      },
    )
  }
  function resetRun() {
    requestRef.current = null
    setRequest(null)
    setFailure(null)
  }
  const state = result?.state
  const status: TestAgentRun['status'] = activeRequest?.unknown
    ? 'unknown'
    : state === 'succeeded' || state === 'failed' || state === 'ended' || state === 'stopped'
      ? state
      : cancel.isPending || result?.metadata.cancellation_state === 'requested'
        ? 'stopping'
        : state === 'waiting' || state === 'retry_pending' || (activeRequest && start.isPending)
          ? 'running'
          : 'unknown'
  const run: TestAgentRun | null = activeRequest
    ? {
        result,
        status,
        currentInvocationId: result?.invocation_id,
        tracing: activeRequest.tracing,
        elapsedSeconds:
          result && isTerminal(result.state) && completedAt !== null
            ? Math.max(0, (completedAt - activeRequest.startedAt) / 1_000)
            : null,
      }
    : null
  return {
    run,
    tab,
    setTab,
    startRun,
    stopRun,
    resetRun,
    pageSessionId,
    recoverRequest,
    isSubmitting: start.isPending,
    requestUnknown: Boolean(activeRequest?.unknown),
    failure,
  }
}
