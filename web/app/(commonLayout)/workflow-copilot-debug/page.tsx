'use client'

import Cookies from 'js-cookie'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'

// Throwaway developer tool for driving the workflow-copilot Fix backend by hand.
// No i18n, no design polish, no reusable components on purpose.

type SessionView = {
  SessionID: string
  AppID: string
  Version: number
  State: string
  CanvasReadOnly: boolean
  RunStatus: string
  Interrupted: boolean
  Conversation: {
    Seq: number
    Kind: string
    Payload: Record<string, unknown>
    AtVersion: number
  }[]
}

type ProgressEntry = {
  id: number
  event: string
  data: unknown
}

function isSessionView(value: unknown): value is SessionView {
  if (typeof value !== 'object' || value === null) return false
  return 'SessionID' in value && 'Version' in value
}

function useCopilotApi(base: string, workspaceId: string) {
  // Memoized so the returned methods stay referentially stable across renders
  // unless the connection inputs actually change (also what earns the `use` prefix).
  return useMemo(() => {
    const root = `${base.replace(/\/$/, '')}/enterprise/workflow-copilot`

    const headers = (json: boolean, csrf: boolean): Record<string, string> => {
      const h: Record<string, string> = {}
      if (json) h['Content-Type'] = 'application/json'
      if (csrf) h[CSRF_HEADER_NAME] = Cookies.get(CSRF_COOKIE_NAME()) || ''
      if (workspaceId) h['X-Workspace-Id'] = workspaceId
      return h
    }

    const create = (appId: string, failedRunId: string) =>
      fetch(`${root}/sessions`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true, true),
        body: JSON.stringify({ app_id: appId, failed_run_id: failedRunId }),
      })

    const get = (id: string) =>
      fetch(`${root}/sessions/${id}`, {
        credentials: 'include',
        headers: headers(false, false),
      })

    const action = (
      id: string,
      kind: string,
      baseVersion: number,
      payload: Record<string, unknown> = {},
    ) =>
      fetch(`${root}/sessions/${id}/actions`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true, true),
        body: JSON.stringify({ kind, payload, base_version: baseVersion }),
      })

    const message = (id: string, text: string, baseVersion: number) =>
      fetch(`${root}/sessions/${id}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true, true),
        body: JSON.stringify({ text, base_version: baseVersion }),
      })

    const streamURL = (id: string) => `${root}/sessions/${id}/stream`

    return { create, get, action, message, streamURL }
  }, [base, workspaceId])
}

// Parses one `event: <kind>\ndata: <json>` SSE frame (already split on the `\n\n` delimiter).
function parseSSEFrame(frame: string): { event: string; data: unknown } | null {
  const lines = frame.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  lines.forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  })
  if (dataLines.length === 0) return null
  const raw = dataLines.join('\n')
  let data: unknown = raw
  try {
    data = JSON.parse(raw)
  } catch {
    // not JSON, keep the raw string
  }
  return { event, data }
}

const ACTION_KINDS = [
  'approve_repair',
  'run_verify',
  'provide_testdata',
  'publish',
  'undo',
  're_fix',
] as const

export default function WorkflowCopilotDebugPage() {
  const [baseUrl, setBaseUrl] = useState('/console/api')
  const [appId, setAppId] = useState('')
  const [failedRunId, setFailedRunId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [messageText, setMessageText] = useState('')

  const [view, setView] = useState<SessionView | null>(null)
  const [lastRaw, setLastRaw] = useState<unknown>(null)
  const [lastError, setLastError] = useState('')
  const [progressLog, setProgressLog] = useState<ProgressEntry[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const progressIdRef = useRef(0)

  const api = useCopilotApi(baseUrl, workspaceId)

  // Cancel the in-flight stream when the page unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const pushProgress = (event: string, data: unknown) => {
    progressIdRef.current += 1
    setProgressLog((prev) => [...prev, { id: progressIdRef.current, event, data }])
  }

  const applyResponse = async (res: Response): Promise<unknown> => {
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // leave as raw text; still shown in the "Last Raw Response" panel
    }
    setLastRaw(parsed)
    setLastError(res.ok ? '' : `HTTP ${res.status}`)
    if (isSessionView(parsed)) setView(parsed)
    return parsed
  }

  const startStream = (sessionId: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    fetch(api.streamURL(sessionId), { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        const reader = res.body?.getReader()
        if (!reader) return
        const decoder = new TextDecoder()
        let buffer = ''
        let done = false
        while (!done) {
          const result = await reader.read()
          done = result.done
          if (result.value) buffer += decoder.decode(result.value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          frames.forEach((frame) => {
            const parsed = parseSSEFrame(frame)
            if (parsed) pushProgress(parsed.event, parsed.data)
          })
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        pushProgress('error', String(err))
      })
  }

  const handleStartFix = async () => {
    try {
      const res = await api.create(appId, failedRunId)
      const parsed = await applyResponse(res)
      if (isSessionView(parsed)) startStream(parsed.SessionID)
    } catch (err) {
      setLastError(String(err))
    }
  }

  const handleGet = async () => {
    if (!view) return
    try {
      const res = await api.get(view.SessionID)
      await applyResponse(res)
    } catch (err) {
      setLastError(String(err))
    }
  }

  const handleAction = async (kind: string, payload: Record<string, unknown> = {}) => {
    if (!view) return
    try {
      const res = await api.action(view.SessionID, kind, view.Version, payload)
      await applyResponse(res)
    } catch (err) {
      setLastError(String(err))
    }
  }

  const handleSendMessage = async () => {
    if (!view) return
    try {
      const res = await api.message(view.SessionID, messageText, view.Version)
      await applyResponse(res)
      setMessageText('')
    } catch (err) {
      setLastError(String(err))
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', maxWidth: 960 }}>
      <h1>Workflow Copilot Debug</h1>
      <p>Throwaway developer tool for driving the copilot Fix backend by hand.</p>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Connection</legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
          <label>
            Base URL
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            App ID
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Failed Run ID
            <input
              value={failedRunId}
              onChange={(e) => setFailedRunId(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Workspace ID
            <input
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => {
              void handleStartFix()
            }}
          >
            Start Fix
          </button>
          <button
            type="button"
            onClick={() => {
              void handleGet()
            }}
            style={{ marginLeft: 8 }}
          >
            Refresh (GET)
          </button>
        </div>
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Actions</legend>
        <div>
          {ACTION_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                void handleAction(kind, kind === 'provide_testdata' ? { mode: 'mock' } : {})
              }}
              style={{ marginRight: 8, marginBottom: 8 }}
            >
              {kind}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
          <input
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="message text"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => {
              void handleSendMessage()
            }}
          >
            Send Message
          </button>
        </div>
      </fieldset>

      {lastError && <div style={{ color: 'red', marginBottom: 16 }}>Error: {lastError}</div>}

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Status</legend>
        {view ? (
          <ul>
            <li>SessionID: {view.SessionID}</li>
            <li>State: {view.State}</li>
            <li>Version: {view.Version}</li>
            <li>CanvasReadOnly: {String(view.CanvasReadOnly)}</li>
            <li>RunStatus: {view.RunStatus}</li>
            <li>Interrupted: {String(view.Interrupted)}</li>
          </ul>
        ) : (
          <p>No session yet.</p>
        )}
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Conversation</legend>
        <ul>
          {(view?.Conversation ?? []).map((entry) => (
            <li key={entry.Seq}>
              {entry.Seq}
              {' · '}
              {entry.Kind}
              {' · '}
              {JSON.stringify(entry.Payload)}
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Progress Log (stream)</legend>
        <ul>
          {progressLog.map((entry) => (
            <li key={entry.id}>
              {entry.event}
              {' · '}
              {JSON.stringify(entry.data)}
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend>Last Raw Response</legend>
        <pre>{JSON.stringify(lastRaw, null, 2)}</pre>
      </fieldset>
    </div>
  )
}
