'use client'

import type { ReactNode } from 'react'
import type {
  Action,
  ChecklistErrorPayload,
  ConversationItem,
} from '@/app/components/workflow-copilot/types'
import { useState } from 'react'
import { useCopilotSession } from '@/app/components/workflow-copilot/use-copilot-session'
import { API_PREFIX } from '@/config'

// Throwaway developer tool for driving the workflow-copilot Fix backend by hand.
// No i18n, no design polish, no reusable UI components on purpose.
// Session/stream request logic lives in `app/components/workflow-copilot/use-copilot-session.ts`,
// shared with the in-editor Workflow Copilot panel (see `app/components/workflow/panel/workflow-copilot-panel`).
//
// Slice 0 Task 7: action buttons are data-driven off `view.actions` (backend-provided
// id/label/kind), not a hardcoded list — see `handleAction` below.

// Renders one conversation item. The interesting card kinds (per Slice 0 Task 7)
// get a compact dedicated rendering; everything else (`user`, `plan`, `form`,
// `challenge`, `resource_select`, `checkpoint`, `error`, `publish`,
// `build_learning`, `preflight_context`) falls back to raw JSON — acceptable
// for a debug harness. `showFullDiff` is the local (client-side-only) toggle
// driven by the `view_changes` action.
function renderConversationItem(entry: ConversationItem, showFullDiff: boolean): ReactNode {
  switch (entry.kind) {
    case 'change_set': {
      const p = entry.payload
      return (
        <>
          change_set · {p.scope} · {p.count} change(s)
          {showFullDiff && p.changes.length > 0 && (
            <ul>
              {p.changes.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
          )}
        </>
      )
    }
    case 'test_result': {
      const p = entry.payload
      return (
        <>
          test_result · [{p.tone}] {p.title} — {p.subtitle}
          {p.run_ids && p.run_ids.length > 0 && ` · runs: ${p.run_ids.join(', ')}`}
        </>
      )
    }
    case 'summary': {
      const p = entry.payload
      return (
        <>
          summary · {p.variant}
          {p.title ? ` · ${p.title}` : ''}
          {p.items && p.items.length > 0 && (
            <ul>
              {p.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </>
      )
    }
    case 'run_context': {
      const p = entry.payload
      return (
        <>
          run_context · {p.title} · {p.error_code} · {p.message}
        </>
      )
    }
    case 'decision':
      return <>decision · {entry.payload.text}</>
    case 'notice':
      return (
        <>
          notice{entry.payload.tone ? ` [${entry.payload.tone}]` : ''} · {entry.payload.text}
        </>
      )
    case 'assistant_turn': {
      const p = entry.payload
      return (
        <>
          assistant_turn · stage {p.stage_id} · {p.reply_text ?? '(no reply text)'}
        </>
      )
    }
    default:
      return (
        <>
          {entry.kind} · {JSON.stringify(entry.payload)}
        </>
      )
  }
}

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
  // `view_changes` is client-side only (see `handleAction`): it toggles this
  // instead of posting to the backend.
  const [showFullDiff, setShowFullDiff] = useState(false)

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

  const handleAction = async (action: Action) => {
    // `view_changes` is a client-side-only affordance (toggles whether
    // `change_set` cards show their full diff below) — it has no backend
    // action_id/handler. Posting it would hit the backend's default
    // `keep_draft` handling for an unrecognized action and silently end the
    // Fix session, so this must stay a local no-op toggle, never `runAction`.
    if (action.id === 'view_changes') {
      setShowFullDiff((prev) => !prev)
      return
    }
    const payload =
      action.id === 'provide_testdata'
        ? { mode: 'mock' }
        : action.id === 'recheck'
          ? { passed: true }
          : {}
    await runAction(action.id, payload)
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
          {(view?.actions ?? [])
            .filter((action) => action.kind !== 'automatic')
            .map((action) => (
              <button
                key={action.id}
                type="button"
                title={`${action.id} (${action.kind})`}
                onClick={() => {
                  void handleAction(action)
                }}
                style={{ marginRight: 8, marginBottom: 8 }}
              >
                {action.label}
              </button>
            ))}
          {(!view?.actions || view.actions.length === 0) && (
            <span style={{ color: '#888' }}>No actions offered by the current session state.</span>
          )}
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
            <li>Phase: {view.phase ?? '—'}</li>
            <li>Version: {view.version}</li>
            <li>CanvasReadOnly: {String(view.canvas_read_only)}</li>
            <li>RunStatus: {view.run_status}</li>
            <li>Interrupted: {String(view.interrupted)}</li>
            <li>ShowFullDiff (local): {String(showFullDiff)}</li>
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
              {renderConversationItem(entry, showFullDiff)}
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
