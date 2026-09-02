import type { ChecklistErrorPayload, SessionModel } from '../types'
import { consoleClient } from '@/service/client'

export const createFixSession = (
  appId: string,
  failedRunId: string,
  modelConfig: SessionModel | undefined,
  signal: AbortSignal,
) =>
  consoleClient.difyBuilder.sessions.post(
    {
      body: {
        app_id: appId,
        scenario: 'fix',
        failed_run_id: failedRunId,
        ...(modelConfig ? { model_config: modelConfig } : {}),
      },
    },
    { signal },
  )

export const createChecklistFixSession = (
  appId: string,
  checklistErrors: ChecklistErrorPayload[],
  modelConfig: SessionModel | undefined,
  signal: AbortSignal,
) =>
  consoleClient.difyBuilder.sessions.post(
    {
      body: {
        app_id: appId,
        scenario: 'fix',
        checklist_errors: checklistErrors,
        ...(modelConfig ? { model_config: modelConfig } : {}),
      },
    },
    { signal },
  )

export const createBuildSession = (
  appId: string,
  goalText: string,
  modelConfig: SessionModel | undefined,
  signal: AbortSignal,
) =>
  consoleClient.difyBuilder.sessions.post(
    {
      body: {
        app_id: appId,
        scenario: 'build',
        goal_text: goalText,
        ...(modelConfig ? { model_config: modelConfig } : {}),
      },
    },
    { signal },
  )

export const createEditSession = (
  appId: string,
  goalText: string,
  modelConfig: SessionModel | undefined,
  signal: AbortSignal,
) =>
  consoleClient.difyBuilder.sessions.post(
    {
      body: {
        app_id: appId,
        scenario: 'edit',
        goal_text: goalText,
        ...(modelConfig ? { model_config: modelConfig } : {}),
      },
    },
    { signal },
  )

export const getSession = (sessionId: string, signal: AbortSignal) =>
  consoleClient.difyBuilder.sessions.bySessionId.get(
    { params: { session_id: sessionId } },
    { context: { silent: true }, signal },
  )

export const runSessionAction = (
  sessionId: string,
  actionId: string,
  payload: Record<string, unknown>,
  baseVersion: number,
  baseAppRevision: string,
  signal: AbortSignal,
) =>
  consoleClient.difyBuilder.sessions.bySessionId.actions.post(
    {
      params: { session_id: sessionId },
      body: {
        action_id: actionId,
        payload,
        base_version: baseVersion,
        base_app_revision: baseAppRevision,
      },
    },
    { signal },
  )

export const sendSessionMessage = (
  sessionId: string,
  text: string,
  baseVersion: number,
  clientTurnId: string,
  signal: AbortSignal,
) =>
  consoleClient.difyBuilder.sessions.bySessionId.messages.post(
    {
      params: { session_id: sessionId },
      body: {
        text,
        base_version: baseVersion,
        client_turn_id: clientTurnId,
      },
    },
    { signal },
  )
