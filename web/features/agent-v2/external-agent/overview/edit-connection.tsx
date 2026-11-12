'use client'

import type {
  ExternalAgentConnectionPayload,
  ExternalAgentVerificationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { ExternalConnectionSettings } from '../../roster/components/external-connection-verification'
import type { ExternalAgentOverview } from '../model'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { ExternalConnectionForm } from '../../roster/components/external-connection-form'
import {
  externalAgentErrorMessage,
  isUnknownExternalSaveResult,
  useExternalConnectionVerification,
} from '../../roster/components/external-connection-verification'
import { toExternalAgentOverview } from '../model'

function EditConnectionSession({ overview }: { overview: ExternalAgentOverview }) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [open, setOpen] = useState(false)
  const [base, setBase] = useState<ExternalAgentOverview>()
  const [review, setReview] = useState<ExternalAgentVerificationResponse>()
  const [settings, setSettings] = useState<ExternalConnectionSettings>()
  const [submitted, setSubmitted] = useState<ExternalAgentConnectionPayload>()
  const [saveUnknown, setSaveUnknown] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const endpointRef = useRef<HTMLInputElement>(null)
  const detail = useQuery(
    consoleQuery.externalAgents.byAgentId.get.queryOptions({
      input: { params: { agent_id: overview.asset.id } },
      enabled: false,
    }),
  )
  const capabilities = useQuery(consoleQuery.externalAgents.capabilities.get.queryOptions())
  const verification = useExternalConnectionVerification({
    agentId: overview.asset.id,
    revisionId: base?.connectionRevisionId ?? overview.connectionRevisionId,
    hasCredential: base?.hasCredential ?? overview.hasCredential,
  })
  const save = useMutation(
    consoleQuery.externalAgents.byAgentId.connection.put.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const pending = verification.pending || save.isPending
  const scopeRef = useRef(verification.scope)
  scopeRef.current = verification.scope

  const { invalidate: invalidateVerification } = verification
  const { reset: resetSave } = save
  const reset = useCallback(() => {
    setBase(undefined)
    setReview(undefined)
    setSettings(undefined)
    setSubmitted(undefined)
    setSaveUnknown(false)
    setSaveError(undefined)
    invalidateVerification()
    resetSave()
  }, [invalidateVerification, resetSave])
  const identityScopeRef = useRef(verification.identityScope)
  useEffect(() => {
    if (identityScopeRef.current !== verification.identityScope) {
      identityScopeRef.current = verification.identityScope
      setOpen(false)
      reset()
    }
  }, [verification.identityScope, reset])
  function openSession() {
    if (saveUnknown) return
    const scope = verification.scope
    void detail.refetch().then((result) => {
      if (scopeRef.current !== scope || !result.data || result.error) return
      const loaded = toExternalAgentOverview(result.data)
      setBase(loaded)
      setSettings({ endpoint: loaded.endpoint, authentication: loaded.authentication, token: '' })
    })
  }
  function loadLatest() {
    verification.invalidate()
    const scope = verification.scope
    void detail.refetch().then((result) => {
      if (scopeRef.current !== scope || !result.data || result.error) return
      const loaded = toExternalAgentOverview(result.data)
      setBase(loaded)
      setSettings({ endpoint: loaded.endpoint, authentication: loaded.authentication, token: '' })
      setReview(undefined)
      setSubmitted(undefined)
      setSaveUnknown(false)
      setSaveError(undefined)
      save.reset()
    })
  }
  function submit() {
    if (save.isPending || !base) return
    let body: ExternalAgentConnectionPayload
    if (saveUnknown && submitted) body = submitted
    else {
      const proof = verification.evidence
      if (!proof || Date.parse(proof.expires_at) <= Date.now()) {
        setSaveError(t(($) => $['external.connection.proofExpired']))
        verification.invalidate()
        return
      }
      body = {
        verification_id: proof.verification_id,
        expected_revision_id: base.connectionRevisionId,
        idempotency_key: crypto.randomUUID(),
      }
    }
    const scope = verification.scope
    setSubmitted(body)
    setSaveError(undefined)
    save.mutate(
      { params: { agent_id: base.asset.id }, body },
      {
        onSuccess: () => {
          if (scopeRef.current === scope) {
            setSaveUnknown(false)
            setSubmitted(undefined)
            setOpen(false)
          }
        },
        onError: (error) => {
          if (scopeRef.current !== scope) return
          const unknown = isUnknownExternalSaveResult(error)
          setSaveUnknown(unknown)
          const status = getHttpErrorStatus(error)
          setSaveError(
            unknown
              ? t(($) => $['external.api.saveUnknown'])
              : status === 409
                ? t(($) => $['external.api.conflict'])
                : externalAgentErrorMessage(
                    error,
                    t(($) => $['external.api.saveFailed']),
                  ),
          )
          if (!unknown) {
            setSubmitted(undefined)
            if (status === 400 || status === 409) verification.invalidate()
          }
        },
      },
    )
  }
  const warnings = review ? [...review.warnings.technical, ...review.warnings.business] : []
  const warningLabels: Record<string, string> = {
    input_modes_narrowed: t(($) => $['external.connection.warnings.inputModesNarrowed']),
    output_modes_narrowed: t(($) => $['external.connection.warnings.outputModesNarrowed']),
    streaming_removed: t(($) => $['external.connection.warnings.streamingRemoved']),
    auth_requirements_changed: t(($) => $['external.connection.warnings.authenticationChanged']),
    traceability_removed: t(($) => $['external.connection.warnings.traceabilityRemoved']),
    agent_info_changed: t(($) => $['external.connection.warnings.agentInfoChanged']),
    skills_changed: t(($) => $['external.connection.warnings.skillsChanged']),
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (pending) details.cancel()
        else {
          setOpen(next)
          if (next) openSession()
        }
      }}
      onOpenChangeComplete={(next) => {
        if (!next && !saveUnknown) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="small"
            className="h-auto px-0 py-0 system-xs-medium text-text-tertiary"
          />
        }
      >
        {t(($) => $['external.overview.editConnection'])}
      </DialogTrigger>
      <DialogContent className="w-150" initialFocus={endpointRef}>
        <DialogHeader>
          <DialogTitle>{t(($) => $['external.overview.editConnection'])}</DialogTitle>
          <DialogDescription>{t(($) => $['external.connection.description'])}</DialogDescription>
          <DialogHeaderCloseButton
            disabled={pending}
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          />
        </DialogHeader>
        {!base || !settings ? (
          <DialogBody>
            {(detail.isPending || detail.isFetching) && (
              <SkeletonRectangle className="h-40 w-full" />
            )}
          </DialogBody>
        ) : review ? (
          <>
            <DialogBody className="space-y-4">
              <h3 className="system-sm-semibold text-text-primary">
                {t(($) => $['external.connection.changes'])}
              </h3>
              <p className="system-sm-regular wrap-break-word text-text-secondary">
                {settings.endpoint}
              </p>
              <p className="system-xs-regular text-text-secondary">
                {review.auth_check === 'passed_for_read_endpoint'
                  ? t(($) => $['external.connection.authReadPassed'])
                  : t(($) => $['external.connection.authNotExercised'])}
              </p>
              {warnings.length ? (
                <ul className="space-y-2 system-sm-regular text-text-warning">
                  {warnings.map((warning) => (
                    <li key={warning}>{warningLabels[warning] ?? warning}</li>
                  ))}
                </ul>
              ) : (
                <p className="system-sm-regular text-text-tertiary">
                  {t(($) => $['external.connection.noWarnings'])}
                </p>
              )}
              {verification.state.status === 'expired' && !saveUnknown && (
                <Alert type="warning">
                  <AlertTitle>{t(($) => $['external.connection.proofExpired'])}</AlertTitle>
                </Alert>
              )}
              {saveError && (
                <Alert type="error">
                  <AlertTitle>{saveError}</AlertTitle>
                  {getHttpErrorStatus(save.error) === 409 && (
                    <Button variant="secondary" size="small" onClick={loadLatest}>
                      {t(($) => $['external.api.loadLatest'])}
                    </Button>
                  )}
                </Alert>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={pending || saveUnknown}
                onClick={() => setReview(undefined)}
              >
                {t(($) => $['operation.back'], { ns: 'common' })}
              </Button>
              <Button
                variant="primary"
                loading={save.isPending}
                disabled={!saveUnknown && !verification.evidence}
                onClick={submit}
              >
                {saveUnknown
                  ? t(($) => $['external.api.retrySave'])
                  : t(($) => $['operation.save'], { ns: 'common' })}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <ExternalConnectionForm
            key={base.connectionRevisionId}
            initialSettings={settings}
            endpointRef={endpointRef}
            verification={verification.state}
            executionEnabled={capabilities.data?.enabled === true}
            hasCredential={base.authentication === 'bearer' && base.hasCredential}
            onVerify={(values) => {
              setSettings({ ...values, token: '' })
              verification.verify(values, setReview)
            }}
            onContinue={() => {
              if (verification.evidence) setReview(verification.evidence)
            }}
            onInvalidate={verification.invalidate}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function EditExternalAgentConnection({ overview }: { overview: ExternalAgentOverview }) {
  return (
    <EditConnectionSession
      key={`${overview.asset.tenant_id}:${overview.asset.id}`}
      overview={overview}
    />
  )
}
