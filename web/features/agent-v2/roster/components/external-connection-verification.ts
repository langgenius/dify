'use client'

import type {
  ExternalAgentVerificationResponse,
  ExternalAgentVerifyPayload,
} from '@dify/contracts/api/console/external-agents/types.gen'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'

export type ExternalConnectionSettings = {
  endpoint: string
  authentication: ExternalAgentVerifyPayload['auth_type']
  token: string
}

export type ExternalConnectionVerificationState =
  | { status: 'unverified' | 'verifying' | 'expired' }
  | { status: 'verified'; evidence: ExternalAgentVerificationResponse }
  | { status: 'failed'; message?: string }

export function externalAgentErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function isUnknownExternalSaveResult(error: unknown): boolean {
  const status = getHttpErrorStatus(error)
  return status === undefined || status === 408 || status >= 500
}

/** Keeps verification evidence scoped to its actor, workspace and immutable edit base. */
export function useExternalConnectionVerification(edit?: {
  agentId: string
  revisionId: string
  hasCredential: boolean
}) {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const profile = useQuery(userProfileQueryOptions())
  const [proof, setProof] = useState<{
    scope: string
    evidence: ExternalAgentVerificationResponse
  }>()
  const [expiredScope, setExpiredScope] = useState<string>()
  const epochRef = useRef(0)
  const verification = useMutation(
    consoleQuery.externalAgents.verify.post.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const identityScope = `${workspaceId}:${profile.data?.profile.id ?? ''}`
  const scope = `${identityScope}:${edit?.agentId ?? ''}:${edit?.revisionId ?? ''}`
  const evidence = proof?.scope === scope ? proof.evidence : undefined
  const expired = expiredScope === scope
  const { reset: resetVerification } = verification

  useEffect(() => {
    epochRef.current += 1
    resetVerification()
  }, [scope, resetVerification])

  useEffect(() => {
    if (!evidence) return
    const timeout = setTimeout(
      () => {
        setProof(undefined)
        setExpiredScope(scope)
      },
      Math.max(0, Date.parse(evidence.expires_at) - Date.now()),
    )
    return () => clearTimeout(timeout)
  }, [evidence, scope])

  const invalidate = useCallback(() => {
    epochRef.current += 1
    setProof(undefined)
    setExpiredScope(undefined)
    resetVerification()
  }, [resetVerification])
  const verify = (
    settings: ExternalConnectionSettings,
    onVerified: (result: ExternalAgentVerificationResponse) => void,
  ) => {
    if (verification.isPending || !workspaceId || !profile.data?.profile.id) return
    const requestEpoch = ++epochRef.current
    setProof(undefined)
    setExpiredScope(undefined)
    const body: ExternalAgentVerifyPayload = {
      endpoint: settings.endpoint.trim(),
      auth_type: settings.authentication,
      credential_action:
        settings.authentication === 'none'
          ? 'remove'
          : !settings.token && edit?.hasCredential
            ? 'keep'
            : 'replace',
      ...(settings.authentication === 'bearer' && settings.token
        ? { credential: settings.token }
        : {}),
      ...(edit ? { agent_id: edit.agentId, expected_connection_revision_id: edit.revisionId } : {}),
    }
    verification.mutate(
      { body },
      {
        onSuccess: (result) => {
          if (requestEpoch !== epochRef.current) return
          if (Date.parse(result.expires_at) <= Date.now()) {
            setExpiredScope(scope)
            return
          }
          setProof({ scope, evidence: result })
          onVerified(result)
        },
      },
    )
  }
  const state: ExternalConnectionVerificationState = verification.isPending
    ? { status: 'verifying' }
    : evidence
      ? { status: 'verified', evidence }
      : expired
        ? { status: 'expired' }
        : verification.error
          ? { status: 'failed', message: externalAgentErrorMessage(verification.error, '') }
          : { status: 'unverified' }
  return {
    evidence,
    state,
    verify,
    invalidate,
    scope,
    identityScope,
    pending: verification.isPending,
  }
}
