'use client'

import type {
  ExternalAgentConnectionPayload,
  ExternalAgentDetailResponse,
  ExternalAgentVerificationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { RefObject } from 'react'
import type { ExternalConnectionSettings } from '../../roster/components/external-connection-verification'
import type { ExternalAgentOverview } from '../model'
import type { ExternalConnectionComparisonSnapshot } from './edit-connection-snapshot'
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
import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { ExternalConnectionFeedback } from '../../roster/components/external-connection-feedback'
import { ExternalConnectionFields } from '../../roster/components/external-connection-fields'
import {
  externalAgentErrorMessage,
  isUnknownExternalSaveResult,
  useExternalConnectionIdentity,
  useExternalConnectionVerification,
} from '../../roster/components/external-connection-verification'
import { toExternalAgentOverview } from '../model'
import { EditConnectionConflict } from './edit-connection-conflict'
import { EditConnectionReview } from './edit-connection-review'
import {
  connectionComparisonChanges,
  createConnectionComparisonSnapshot,
} from './edit-connection-snapshot'

type EditRecovery = {
  body: ExternalAgentConnectionPayload
  baseDetail: ExternalAgentDetailResponse
  settings: ExternalConnectionSettings
  review: ExternalAgentVerificationResponse
  comparison: ExternalConnectionComparisonSnapshot
  conflictResolution?: 'keep' | 'latest'
}

export function EditExternalAgentConnection({ overview }: { overview: ExternalAgentOverview }) {
  const { identityScope } = useExternalConnectionIdentity()
  return (
    <EditConnectionDialog
      key={`${identityScope}:${overview.asset.tenant_id}:${overview.asset.id}`}
      overview={overview}
    />
  )
}

function EditConnectionDialog({ overview }: { overview: ExternalAgentOverview }) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const dialogActionsRef = useRef<DialogActions>(null)
  const endpointRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef<{ pending: boolean }>(null)
  const [recovery, setRecovery] = useState<EditRecovery>()
  const save = useMutation(
    consoleQuery.externalAgents.byAgentId.connection.put.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )

  function submit(attempt: EditRecovery, onRejected: (failure: unknown) => void) {
    if (save.isPending) return
    save.mutate(
      { params: { agent_id: overview.asset.id }, body: attempt.body },
      {
        onSuccess: () => {
          dialogActionsRef.current?.close()
          setRecovery(undefined)
        },
        onError: (error) => {
          if (isUnknownExternalSaveResult(error)) {
            setRecovery(attempt)
          } else {
            setRecovery(undefined)
            onRejected(error)
          }
        },
      },
    )
  }

  return (
    <Dialog
      disablePointerDismissal
      actionsRef={dialogActionsRef}
      onOpenChange={(open, details) => {
        if (
          !open &&
          (save.isPending || sessionRef.current?.pending) &&
          details.reason !== 'imperative-action'
        )
          details.cancel()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) save.reset()
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
        <EditConnectionSession
          overview={overview}
          endpointRef={endpointRef}
          sessionRef={sessionRef}
          saving={save.isPending}
          recovery={recovery}
          onSave={submit}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditConnectionSession({
  overview,
  endpointRef,
  sessionRef,
  saving,
  recovery,
  onSave,
}: {
  overview: ExternalAgentOverview
  endpointRef: RefObject<HTMLInputElement | null>
  sessionRef: RefObject<{ pending: boolean } | null>
  saving: boolean
  recovery: EditRecovery | undefined
  onSave: (attempt: EditRecovery, onRejected: (failure: unknown) => void) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const [baseDetail, setBaseDetail] = useState(recovery?.baseDetail)
  const base = baseDetail && toExternalAgentOverview(baseDetail)
  const [review, setReview] = useState(recovery?.review)
  const [settings, setSettings] = useState(recovery?.settings)
  const saveUnknown = Boolean(recovery)
  const [rejectedError, setRejectedError] = useState<string>()
  const saveError = saveUnknown ? t(($) => $['external.api.saveUnknown']) : rejectedError
  const [conflictResolution, setConflictResolution] = useState(recovery?.conflictResolution)
  const [conflictDraft, setConflictDraft] = useState<ExternalConnectionComparisonSnapshot>()
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const [allowVerificationWithoutEdits, setAllowVerificationWithoutEdits] = useState(false)
  const submitLabelId = useId()
  const loadEpochRef = useRef(0)
  const detail = useQuery(
    consoleQuery.externalAgents.byAgentId.get.queryOptions({
      input: { params: { agent_id: overview.asset.id } },
      enabled: false,
      retry: false,
    }),
  )
  const capabilities = useQuery(consoleQuery.externalAgents.capabilities.get.queryOptions())
  const verification = useExternalConnectionVerification(
    {
      agentId: overview.asset.id,
      revisionId: base?.connectionRevisionId ?? overview.connectionRevisionId,
      hasCredential: base?.hasCredential ?? overview.hasCredential,
    },
    recovery?.review,
  )
  const pending = verification.pending || saving || resolvingConflict
  useImperativeHandle(sessionRef, () => ({ pending: verification.pending || resolvingConflict }), [
    verification.pending,
    resolvingConflict,
  ])
  const hasChanges = Boolean(
    base &&
    settings &&
    (settings.endpoint.trim() !== base.endpoint.trim() ||
      settings.authentication !== base.authentication ||
      (settings.authentication === 'bearer' && settings.token !== '')),
  )
  const executionEnabled = capabilities.data?.enabled === true
  const canSubmit =
    saveUnknown ||
    Boolean(verification.evidence) ||
    (executionEnabled && (hasChanges || allowVerificationWithoutEdits))
  const scopeRef = useRef(verification.scope)
  scopeRef.current = verification.scope

  const { refetch } = detail
  const initialRecoveryRef = useRef(recovery)
  useEffect(() => {
    if (initialRecoveryRef.current)
      return () => {
        loadEpochRef.current += 1
      }
    const scope = scopeRef.current
    const epoch = ++loadEpochRef.current
    void refetch().then((result) => {
      if (
        loadEpochRef.current !== epoch ||
        scopeRef.current !== scope ||
        !result.data ||
        result.error
      )
        return
      const loaded = toExternalAgentOverview(result.data)
      setBaseDetail(result.data)
      setSettings({ endpoint: loaded.endpoint, authentication: loaded.authentication, token: '' })
    })
    return () => {
      loadEpochRef.current += 1
    }
  }, [refetch])

  function savedAudit(connection: ExternalAgentOverview) {
    const name =
      connection.connectionSavedBy?.name?.trim() || connection.connectionSavedBy?.id || '—'
    return connection.connectionSavedAt
      ? t(($) => $['external.connection.conflict.savedBy'], {
          name,
          time: formatTimeFromNow(Date.parse(connection.connectionSavedAt)),
        })
      : t(($) => $['external.connection.conflict.savedByOnly'], { name })
  }
  function resolveConflict(draft: ExternalConnectionComparisonSnapshot) {
    verification.invalidate()
    setReview(undefined)
    setRejectedError(undefined)
    setConflictResolution(undefined)
    setResolvingConflict(true)
    const scope = verification.scope
    const epoch = ++loadEpochRef.current
    void detail.refetch().then((result) => {
      if (loadEpochRef.current !== epoch || scopeRef.current !== scope) return
      setResolvingConflict(false)
      if (
        result.data &&
        !result.error &&
        connectionComparisonChanges(draft, result.data.connection).length === 0
      ) {
        // Rebase identical public configuration, but require a fresh proof for the latest revision.
        setBaseDetail(result.data)
        setConflictDraft(undefined)
        setAllowVerificationWithoutEdits(true)
      } else {
        setConflictDraft(draft)
        setSettings((current) => current && { ...current, token: '' })
      }
    })
  }
  function showConflict(verified?: ExternalAgentVerificationResponse, draftSettings = settings) {
    if (!baseDetail || !draftSettings) return
    resolveConflict(
      createConnectionComparisonSnapshot(baseDetail.connection, draftSettings, verified),
    )
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
      setBaseDetail(result.data)
      setSettings(
        keepEdits && settings
          ? { ...settings, token: '' }
          : { endpoint: loaded.endpoint, authentication: loaded.authentication, token: '' },
      )
      setConflictResolution(keepEdits ? 'keep' : 'latest')
      setConflictDraft(undefined)
      setAllowVerificationWithoutEdits(false)
      setReview(undefined)
      setRejectedError(undefined)
    })
  }
  function submit() {
    if (saving || !base || !baseDetail || !settings) return
    let attempt = recovery
    if (!attempt) {
      const proof = verification.evidence
      if (!proof || Date.parse(proof.expires_at) <= Date.now()) {
        setRejectedError(t(($) => $['external.connection.proofExpired']))
        verification.invalidate()
        return
      }
      attempt = {
        body: {
          verification_id: proof.verification_id,
          expected_revision_id: base.connectionRevisionId,
          idempotency_key: uuid4(),
        },
        baseDetail,
        settings: { ...settings, token: '' },
        review: proof,
        comparison: createConnectionComparisonSnapshot(baseDetail.connection, settings, proof),
        conflictResolution,
      }
    }
    setRejectedError(undefined)
    onSave(attempt, (error) => {
      const status = getHttpErrorStatus(error)
      setRejectedError(
        status === 409
          ? undefined
          : externalAgentErrorMessage(
              error,
              t(($) => $['external.connection.errors.changesKept']),
            ),
      )
      if (status === 400) verification.invalidate()
      if (status === 409) resolveConflict(attempt.comparison)
    })
  }
  function updateSettings(next: ExternalConnectionSettings) {
    if (pending || saveUnknown) return
    setSettings(next)
    setReview(undefined)
    setRejectedError(undefined)
    verification.invalidate()
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
    setRejectedError(undefined)
    verification.verify(draft, setReview, () => showConflict(undefined, draft))
  }
  const latest = conflictDraft && detail.data && !detail.isError ? detail.data : undefined

  return (
    <>
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
      ) : conflictDraft ? (
        <>
          <DialogBody>
            <EditConnectionConflict
              draft={conflictDraft}
              latest={latest?.connection}
              latestSavedAudit={latest && savedAudit(toExternalAgentOverview(latest))}
              loading={detail.isFetching || resolvingConflict}
              loadFailed={detail.isError}
              onRetry={() => resolveConflict(conflictDraft)}
            />
          </DialogBody>
          <DialogFooter className="max-sm:flex-col max-sm:items-stretch">
            <DialogClose render={<Button variant="secondary" disabled={pending} />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button
              variant="secondary"
              disabled={detail.isFetching || resolvingConflict || !latest}
              onClick={() => loadLatest(false)}
            >
              {t(($) => $['external.connection.useLatest'])}
            </Button>
            <Button
              variant="primary"
              disabled={detail.isFetching || resolvingConflict || !latest}
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
                conflictResolution === 'keep'
                  ? t(($) => $['external.connection.conflict.latestEndpoint'], {
                      endpoint: base.endpoint,
                      name:
                        base.connectionSavedBy?.name?.trim() || base.connectionSavedBy?.id || '—',
                    })
                  : conflictResolution === 'latest'
                    ? savedAudit(base)
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
    </>
  )
}
