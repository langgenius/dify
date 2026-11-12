'use client'

import type {
  ExternalAgentCreatePayload,
  ExternalAgentVerificationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  useExternalConnectionVerification,
} from './external-connection-verification'

const emptySettings: ExternalConnectionSettings = {
  endpoint: '',
  authentication: 'none',
  token: '',
}
const emptyDetails: ExternalAgentConnectionDetails = { name: '', role: '', description: '' }

export function ConnectExternalAgent() {
  const { t } = useTranslation(['agentRoster', 'common'])
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'connection' | 'details'>('connection')
  const [settings, setSettings] = useState(emptySettings)
  const [details, setDetails] = useState(emptyDetails)
  const [review, setReview] = useState<ExternalAgentVerificationResponse>()
  const [submitted, setSubmitted] = useState<ExternalAgentCreatePayload>()
  const [saveUnknown, setSaveUnknown] = useState(false)
  const [error, setError] = useState<string>()
  const endpointRef = useRef<HTMLInputElement>(null)
  const capabilities = useQuery(consoleQuery.externalAgents.capabilities.get.queryOptions())
  const verification = useExternalConnectionVerification()
  const create = useMutation(
    consoleQuery.externalAgents.post.mutationOptions({ context: { silent: true }, retry: false }),
  )
  const pending = verification.pending || create.isPending
  const executionEnabled = capabilities.data?.enabled === true
  const previousScopeRef = useRef(verification.scope)
  const currentScopeRef = useRef(verification.scope)
  currentScopeRef.current = verification.scope

  const { invalidate: invalidateVerification } = verification
  const { reset: resetCreate } = create
  const reset = useCallback(() => {
    setStep('connection')
    setSettings(emptySettings)
    setDetails(emptyDetails)
    setReview(undefined)
    setSubmitted(undefined)
    setSaveUnknown(false)
    setError(undefined)
    invalidateVerification()
    resetCreate()
  }, [invalidateVerification, resetCreate])
  useEffect(() => {
    if (previousScopeRef.current !== verification.scope) {
      previousScopeRef.current = verification.scope
      setOpen(false)
      reset()
    }
  }, [verification.scope, reset])

  function save(fields: ExternalAgentConnectionDetails) {
    if (create.isPending) return
    let body: ExternalAgentCreatePayload
    if (saveUnknown && submitted) body = submitted
    else {
      const evidence = verification.evidence
      if (!executionEnabled || !evidence || Date.parse(evidence.expires_at) <= Date.now()) {
        setError(t(($) => $['external.connection.proofExpired']))
        verification.invalidate()
        return
      }
      body = {
        verification_id: evidence.verification_id,
        metadata: { name: fields.name, role: fields.role, description: fields.description },
        idempotency_key: crypto.randomUUID(),
      }
    }
    setSubmitted(body)
    setError(undefined)
    const requestScope = verification.scope
    create.mutate(
      { body },
      {
        onSuccess: (operation) => {
          if (currentScopeRef.current !== requestScope) return
          setSaveUnknown(false)
          setSubmitted(undefined)
          setOpen(false)
          router.push(getExternalAgentOverviewPath(operation.resource_id))
        },
        onError: (failure) => {
          if (currentScopeRef.current !== requestScope) return
          const unknown = isUnknownExternalSaveResult(failure)
          setSaveUnknown(unknown)
          setError(
            unknown
              ? t(($) => $['external.api.saveUnknown'])
              : externalAgentErrorMessage(
                  failure,
                  t(($) => $['external.api.saveFailed']),
                ),
          )
          if (!unknown) {
            setSubmitted(undefined)
            if (getHttpErrorStatus(failure) === 400) verification.invalidate()
          }
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, eventDetails) => {
        if (pending) eventDetails.cancel()
        else setOpen(next)
      }}
      onOpenChangeComplete={(next) => {
        if (!next && !saveUnknown) reset()
      }}
    >
      <DialogTrigger render={<Button variant="primary" disabled={!executionEnabled} />}>
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['external.connect'])}
      </DialogTrigger>
      <DialogContent className="w-150" initialFocus={endpointRef}>
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
            pending={create.isPending}
            locked={create.isPending || saveUnknown}
            canSave={
              Boolean(saveUnknown && submitted) ||
              Boolean(executionEnabled && verification.evidence && !create.isPending)
            }
            error={
              error ??
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
      </DialogContent>
    </Dialog>
  )
}
