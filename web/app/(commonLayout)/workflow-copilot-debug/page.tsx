'use client'

import { useState } from 'react'
import type { ChecklistErrorPayload } from '@/app/components/workflow-copilot/types'
import { COPILOT_ACTION_KINDS } from '@/app/components/workflow-copilot/types'
import { useCopilotSession } from '@/app/components/workflow-copilot/use-copilot-session'
import { API_PREFIX } from '@/config'

// Throwaway developer tool for driving the workflow-copilot Fix backend by hand.
// No i18n, no design polish, no reusable UI components on purpose.
// Session/stream request logic lives in `app/components/workflow-copilot/use-copilot-session.ts`,
// shared with the in-editor Workflow Copilot panel (see `app/components/workflow/panel/workflow-copilot-panel`).

export default function WorkflowCopilotDebugPage() {
  const [baseUrl, setBaseUrl] = useState(API_PREFIX)
  const [appId, setAppId] = useState('')
  const [failedRunId, setFailedRunId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [messageText, setMessageText] = useState('')
  const [checklistJson, setChecklistJson] = useState(
    '[{"node_id":"code-1","node_type":"code","title":"Code","messages":["Code node config error"],"unconnected":false,"plugin_missing":false}]',
  )
  const [checklistError, setChecklistError] = useState('')

  const { view, lastRaw, lastError, progressLog, startFix, startChecklistFix, refresh, runAction, sendMessage } =
    useCopilotSession({ baseUrl, workspaceId })

  const handleStartFix = async () => {
    await startFix(appId, failedRunId)
  }

  const handleStartChecklistFix = async () => {
    let errors: ChecklistErrorPayload[]
    try {
      errors = JSON.parse(checklistJson)
    } catch {
      setChecklistError('Checklist Errors must be a valid JSON array of ChecklistErrorPayload.')
      return
    }
    setChecklistError('')
    await startChecklistFix(appId, errors)
  }

  const handleGet = async () => {
    await refresh()
  }

  const handleAction = async (kind: (typeof COPILOT_ACTION_KINDS)[number]) => {
    const payload =
      kind === 'provide_testdata' ? { mode: 'mock' } : kind === 'recheck' ? { passed: true } : {}
    await runAction(kind, payload)
  }

  const handleSendMessage = async () => {
    const ok = await sendMessage(messageText)
    if (ok) setMessageText('')
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
          <label>
            Checklist Errors (JSON) — for Start Checklist Fix
            <textarea
              value={checklistJson}
              onChange={(e) => setChecklistJson(e.target.value)}
              rows={3}
              style={{ width: '100%', fontFamily: 'monospace' }}
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
              void handleStartChecklistFix()
            }}
            style={{ marginLeft: 8 }}
          >
            Start Checklist Fix
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
        {checklistError && <div style={{ color: 'red', marginTop: 8 }}>{checklistError}</div>}
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Actions</legend>
        <div>
          {COPILOT_ACTION_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                void handleAction(kind)
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
            <li>SessionID: {view.session_id}</li>
            <li>State: {view.state}</li>
            <li>Version: {view.version}</li>
            <li>CanvasReadOnly: {String(view.canvas_read_only)}</li>
            <li>RunStatus: {view.run_status}</li>
            <li>Interrupted: {String(view.interrupted)}</li>
          </ul>
        ) : (
          <p>No session yet.</p>
        )}
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Conversation</legend>
        <ul>
          {(view?.conversation ?? []).map((entry) => (
            <li key={entry.seq}>
              {entry.seq}
              {' · '}
              {entry.kind}
              {' · '}
              {JSON.stringify(entry.payload)}
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
