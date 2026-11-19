'use client'

import type {
  ExternalAgentConnectionPayload,
  ExternalAgentVerificationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { ExternalConnectionSettings } from '../../roster/components/external-connection-verification'
import type { ExternalAgentOverview } from '../model'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { ExternalConnectionFeedback } from '../../roster/components/external-connection-feedback'
import { ExternalConnectionFields } from '../../roster/components/external-connection-fields'
import {
  externalAgentErrorMessage,
  isUnknownExternalSaveResult,
  useExternalConnectionVerification,
} from '../../roster/components/external-connection-verification'
import { toExternalAgentOverview } from '../model'
import { EditConnectionConflict } from './edit-connection-conflict'
import { EditConnectionReview } from './edit-connection-review'

function EditConnectionSession({ overview }: { overview: ExternalAgentOverview }) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [open, setOpen] = useState(false)
  const [base, setBase] = useState<ExternalAgentOverview>()
  const [review, setReview] = useState<ExternalAgentVerificationResponse>()
  const [settings, setSettings] = useState<ExternalConnectionSettings>()
  const [submitted, setSubmitted] = useState<ExternalAgentConnectionPayload>()
  const [saveUnknown, setSaveUnknown] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [latestEndpoint, setLatestEndpoint] = useState<string>()
  const endpointRef = useRef<HTMLInputElement>(null)
  const submitLabelId = useId()
  const loadEpochRef = useRef(0)
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
  const hasChanges = Boolean(
    base &&
    settings &&
    (settings.endpoint.trim() !== base.endpoint.trim() ||
      settings.authentication !== base.authentication ||
      (settings.authentication === 'bearer' && settings.token !== '')),
  )
  const executionEnabled = capabilities.data?.enabled === true
  const canSubmit =
    saveUnknown || Boolean(verification.evidence) || (executionEnabled && hasChanges)
  const scopeRef = useRef(verification.scope)
  scopeRef.current = verification.scope

  const { invalidate: invalidateVerification } = verification
  const { reset: resetSave } = save
  const reset = useCallback(() => {
    loadEpochRef.current += 1
    setBase(undefined)
    setReview(undefined)
    setSettings(undefined)
    setSubmitted(undefined)
    setSaveUnknown(false)
    setSaveError(undefined)
    setLatestEndpoint(undefined)
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
    const epoch = ++loadEpochRef.current
    void detail.refetch().then((result) => {
      if (
        loadEpochRef.current !== epoch ||
        scopeRef.current !== scope ||
        !result.data ||
        result.error
      )
        return
      const loaded = toExternalAgentOverview(result.data)
      setBase(loaded)
      setSettings({ endpoint: loaded.endpoint, authentication: loaded.authentication, token: '' })
    })
  }
  function loadLatest(keepEdits: boolean) {
    verification.invalidate()
    const scope = verification.scope
    const epoch = ++loadEpochRef.current
    void detail.refetch().then((result) => {
      if (
        loadEpochRef.current !== epoch ||
        scopeRef.current !== scope ||
        !result.data ||
        result.error
      )
        return
      const loaded = toExternalAgentOverview(result.data)
      setBase(loaded)
      setSettings(
        keepEdits && settings
          ? { ...settings, token: '' }
          : { endpoint: loaded.endpoint, authentication: loaded.authentication, token: '' },
      )
      setLatestEndpoint(keepEdits ? loaded.endpoint : undefined)
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
        idempotency_key: uuid4(),
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
                ? undefined
                : externalAgentErrorMessage(
                    error,
                    t(($) => $['external.connection.errors.changesKept']),
                  ),
          )
          if (!unknown) {
            setSubmitted(undefined)
            if (status === 400 || status === 409) verification.invalidate()
            if (status === 409) void detail.refetch()
          }
        },
      },
    )
  }
  function updateSettings(next: ExternalConnectionSettings) {
    if (pending || saveUnknown) return
    setSettings(next)
    setReview(undefined)
    setSaveError(undefined)
    verification.invalidate()
    save.reset()
  }
  function verifyOrSave(values: Pick<ExternalConnectionSettings, 'endpoint' | 'token'>) {
    if (pending || !settings || !canSubmit) return
    if (saveUnknown || verification.evidence) {
      submit()
      return
    }
    const draft: ExternalConnectionSettings = {
      endpoint: values.endpoint.trim(),
      authentication: settings.authentication,
      token: settings.authentication === 'bearer' ? (values.token ?? '') : '',
    }
    setSettings(draft)
    setReview(undefined)
    setSaveError(undefined)
    save.reset()
    verification.verify(draft, setReview)
  }
  const conflicted = getHttpErrorStatus(save.error) === 409
  const latest =
    conflicted && detail.data && !detail.isError ? toExternalAgentOverview(detail.data) : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (pending) details.cancel()
        else {
          setOpen(next)
          if (next) openSession()
          else loadEpochRef.current += 1
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
            className="h-auto px-0 py-0 system-xs-medium text-text-tertiary hover:bg-transparent hover:text-text-secondary"
          />
        }
      >
        {t(($) => $['external.overview.editConnection'])}
      </DialogTrigger>
      <DialogContent className="w-150" initialFocus={endpointRef}>
        <DialogHeader>
          <DialogTitle>{t(($) => $['external.overview.editConnection'])}</DialogTitle>
          <DialogHeaderCloseButton
            disabled={pending}
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          />
        </DialogHeader>
        {!base || !settings ? (
          <DialogBody>
            {(detail.isPending || detail.isFetching) && (
              <LoadingPlaceholder
                className={overview.authentication === 'bearer' ? 'h-80' : 'h-54'}
              />
            )}
          </DialogBody>
        ) : conflicted ? (
          <>
            <DialogBody>
              <EditConnectionConflict
                settings={settings}
                latest={latest}
                loading={detail.isFetching}
              />
            </DialogBody>
            <DialogFooter className="max-sm:flex-col max-sm:items-stretch">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button
                variant="secondary"
                disabled={detail.isFetching}
                onClick={() => loadLatest(false)}
              >
                {t(($) => $['external.connection.useLatest'])}
              </Button>
              <Button
                variant="primary"
                disabled={detail.isFetching}
                onClick={() => loadLatest(true)}
              >
                {t(($) => $['external.connection.keepMyEdits'])}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form<Pick<ExternalConnectionSettings, 'endpoint' | 'token'>>
            key={base.connectionRevisionId}
            className="contents"
            onFormSubmit={verifyOrSave}
          >
            <DialogBody className="flex flex-col gap-4">
              <ExternalConnectionFields
                settings={settings}
                endpointRef={endpointRef}
                disabled={pending || saveUnknown}
                verified={Boolean(verification.evidence) || saveUnknown}
                hasCredential={base.authentication === 'bearer' && base.hasCredential}
                endpointDescription={
                  latestEndpoint
                    ? t(($) => $['external.connection.conflict.latestEndpoint'], {
                        endpoint: latestEndpoint,
                      })
                    : undefined
                }
                onChange={updateSettings}
              />
              {review && (
                <EditConnectionReview
                  agentId={base.asset.id}
                  review={review}
                  verified={Boolean(verification.evidence) && !saveUnknown}
                />
              )}
              {!saveUnknown && (
                <ExternalConnectionFeedback
                  verification={verification.state}
                  executionEnabled={executionEnabled}
                  editing
                  showVerifiedStatus={false}
                />
              )}
              {saveError && (
                <Alert type="error">
                  <AlertTitle>
                    {saveUnknown ? saveError : t(($) => $['external.connection.errors.saveFailed'])}
                  </AlertTitle>
                  {!saveUnknown && <AlertDescription>{saveError}</AlertDescription>}
                </Alert>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose disabled={pending} render={<Button variant="secondary" />}>
                {saveUnknown
                  ? t(($) => $['operation.close'], { ns: 'common' })
                  : t(($) => $['operation.cancel'], { ns: 'common' })}
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                loading={pending}
                disabled={!canSubmit}
                aria-labelledby={submitLabelId}
              >
                <span id={submitLabelId}>
                  {saveUnknown
                    ? t(($) => $['external.api.retrySave'])
                    : verification.pending
                      ? t(($) => $['external.connection.verifying'])
                      : verification.evidence
                        ? t(($) => $['external.connection.saveChanges'])
                        : t(($) => $['external.connection.verify'])}
                </span>
              </Button>
            </DialogFooter>
          </Form>
        )}
        <p className="shrink-0 border-t border-divider-subtle bg-background-section px-6 py-3 text-center system-xs-regular text-text-tertiary">
          {t(($) => $['external.connection.callsHint'])}
        </p>
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
