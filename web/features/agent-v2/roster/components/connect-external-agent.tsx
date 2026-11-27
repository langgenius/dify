'use client'

import type {
  ExternalAgentCreatePayload,
  ExternalAgentVerificationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { RefObject } from 'react'
import type { ExternalAgentConnectionDetails } from './external-agent-details-form'
import type { ExternalConnectionSettings } from './external-connection-verification'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import { stringValue } from '@/features/agent-v2/external-agent/model'
import { getExternalAgentOverviewPath } from '@/features/agent-v2/external-agent/routes'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { ExternalAgentDetailsForm } from './external-agent-details-form'
import { ExternalConnectionForm } from './external-connection-form'
import {
  externalAgentErrorMessage,
  isUnknownExternalSaveResult,
  useExternalConnectionIdentity,
  useExternalConnectionVerification,
} from './external-connection-verification'

const emptySettings: ExternalConnectionSettings = {
  endpoint: '',
  authentication: 'none',
  token: '',
}
const emptyDetails: ExternalAgentConnectionDetails = { name: '', role: '', description: '' }

type CreateRecovery = {
  body: ExternalAgentCreatePayload & { metadata: ExternalAgentConnectionDetails }
  settings: ExternalConnectionSettings
  review: ExternalAgentVerificationResponse
}

export function ConnectExternalAgent() {
  const { identityScope } = useExternalConnectionIdentity()
  return <ConnectExternalAgentDialog key={identityScope} />
}

function ConnectExternalAgentDialog() {
  const { t } = useTranslation(['agentRoster', 'common'])
  const router = useRouter()
  const dialogActionsRef = useRef<DialogActions>(null)
  const endpointRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef<{ pending: boolean }>(null)
  const [recovery, setRecovery] = useState<CreateRecovery>()
  const capabilities = useQuery(consoleQuery.externalAgents.capabilities.get.queryOptions())
  const executionEnabled = capabilities.data?.enabled === true
  const create = useMutation(
    consoleQuery.externalAgents.post.mutationOptions({ meta: { errorToast: false }, retry: false }),
  )

  function save(attempt: CreateRecovery, onRejected: (failure: unknown) => void) {
    if (create.isPending) return
    create.mutate(
      { body: attempt.body },
      {
        onSuccess: (operation) => {
          dialogActionsRef.current?.close()
          setRecovery(undefined)
          router.push(getExternalAgentOverviewPath(operation.resource_id))
        },
        onError: (failure) => {
          if (isUnknownExternalSaveResult(failure)) {
            setRecovery(attempt)
          } else {
            setRecovery(undefined)
            onRejected(failure)
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
          (create.isPending || sessionRef.current?.pending) &&
          details.reason !== 'imperative-action'
        )
          details.cancel()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) create.reset()
      }}
    >
      <DialogTrigger render={<Button variant="primary" disabled={!executionEnabled} />}>
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['external.connect'])}
      </DialogTrigger>
      <DialogContent className="w-150" initialFocus={endpointRef}>
        <ConnectExternalAgentSession
          endpointRef={endpointRef}
          sessionRef={sessionRef}
          executionEnabled={executionEnabled}
          saving={create.isPending}
          recovery={recovery}
          onSave={save}
        />
      </DialogContent>
    </Dialog>
  )
}

function ConnectExternalAgentSession({
  endpointRef,
  sessionRef,
  executionEnabled,
  saving,
  recovery,
  onSave,
}: {
  endpointRef: RefObject<HTMLInputElement | null>
  sessionRef: RefObject<{ pending: boolean } | null>
  executionEnabled: boolean
  saving: boolean
  recovery: CreateRecovery | undefined
  onSave: (attempt: CreateRecovery, onRejected: (failure: unknown) => void) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [step, setStep] = useState<'connection' | 'details'>(recovery ? 'details' : 'connection')
  const [settings, setSettings] = useState(recovery?.settings ?? emptySettings)
  const [details, setDetails] = useState(recovery?.body.metadata ?? emptyDetails)
  const [review, setReview] = useState(recovery?.review)
  const [error, setError] = useState<string>()
  const verification = useExternalConnectionVerification(undefined, recovery?.review)
  const saveUnknown = Boolean(recovery)
  const pending = verification.pending || saving
  useImperativeHandle(sessionRef, () => ({ pending: verification.pending }), [verification.pending])

  function save(fields: ExternalAgentConnectionDetails) {
    if (saving) return
    let attempt = recovery
    if (!attempt) {
      const evidence = verification.evidence
      if (!executionEnabled || !evidence || Date.parse(evidence.expires_at) <= Date.now()) {
        setError(t(($) => $['external.connection.proofExpired']))
        verification.invalidate()
        return
      }
      attempt = {
        body: {
          verification_id: evidence.verification_id,
          metadata: { name: fields.name, role: fields.role, description: fields.description },
          idempotency_key: uuid4(),
        },
        review: evidence,
        settings,
      }
    }
    setError(undefined)
    onSave(attempt, (failure) => {
      setError(
        externalAgentErrorMessage(
          failure,
          t(($) => $['external.api.saveFailed']),
        ),
      )
      if (getHttpErrorStatus(failure) === 400) verification.invalidate()
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $['external.connect'])}</DialogTitle>
        <DialogDescription>{t(($) => $['external.connection.description'])}</DialogDescription>
        <DialogHeaderCloseButton
          disabled={pending}
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        />
      </DialogHeader>
      {step === 'details' && review ? (
        <ExternalAgentDetailsForm
          verification={review}
          initialDetails={details}
          pending={saving}
          locked={saving || saveUnknown}
          canSave={saveUnknown || Boolean(executionEnabled && verification.evidence && !saving)}
          error={
            (saveUnknown ? t(($) => $['external.api.saveUnknown']) : error) ??
            (verification.state.status === 'expired'
              ? t(($) => $['external.connection.proofExpired'])
              : undefined)
          }
          onBack={(fields) => {
            setDetails(fields)
            setStep('connection')
          }}
          onSave={save}
        />
      ) : (
        <ExternalConnectionForm
          endpointRef={endpointRef}
          initialSettings={settings}
          verification={verification.state}
          executionEnabled={executionEnabled}
          onVerify={(values) => {
            setSettings({ ...values, token: '' })
            setError(undefined)
            verification.verify(values, (result) => {
              setReview(result)
              setDetails({
                name: stringValue(result.card.name),
                role: '',
                description: stringValue(result.card.description),
              })
              setStep('details')
            })
          }}
          onContinue={() => setStep('details')}
          onInvalidate={verification.invalidate}
        />
      )}
    </>
  )
}
