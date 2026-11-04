'use client'

import type { ExternalAgentConnectionDetails } from './external-agent-details-form'
import type {
  ExternalConnectionSettings,
  ExternalConnectionVerificationState,
  VerifyExternalConnection,
} from './external-connection-verification'
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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { externalConnectionPreview } from '../external-roster-preview'
import { ExternalAgentDetailsForm } from './external-agent-details-form'
import { ExternalConnectionForm } from './external-connection-form'

type ConnectionSession = {
  step: 'connection' | 'details'
  settings: ExternalConnectionSettings
  verification: ExternalConnectionVerificationState
  details: ExternalAgentConnectionDetails
}

function createConnectionSession(): ConnectionSession {
  return {
    step: 'connection',
    settings: { endpoint: '', authentication: 'none', token: '' },
    verification: { status: 'unverified' },
    details: {
      name: externalConnectionPreview.name,
      role: '',
      description: externalConnectionPreview.description,
    },
  }
}

// Local design preview only. The API contract is not connected yet.
const verifyConnectionPreview: VerifyExternalConnection = () =>
  Promise.resolve({ status: 'verified', agent: externalConnectionPreview })

type ConnectExternalAgentProps = {
  onConnect: (details: ExternalAgentConnectionDetails) => void
  verifyConnection?: VerifyExternalConnection
}

export function ConnectExternalAgent({
  onConnect,
  verifyConnection = verifyConnectionPreview,
}: ConnectExternalAgentProps) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(createConnectionSession)
  const endpointRef = useRef<HTMLInputElement>(null)
  const pending = session.verification.status === 'verifying'

  async function verify(settings: ExternalConnectionSettings) {
    if (pending) return
    setSession((current) => ({ ...current, settings, verification: { status: 'verifying' } }))
    try {
      const result = await verifyConnection(settings)
      setSession((current) =>
        result.status === 'verified'
          ? {
              ...current,
              verification: result,
              step: 'details',
              details: { name: result.agent.name, role: '', description: result.agent.description },
            }
          : { ...current, verification: result },
      )
    } catch {
      setSession((current) => ({
        ...current,
        verification: { status: 'failed', reason: 'unknown' },
      }))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, eventDetails) => {
        if (pending) {
          eventDetails.cancel()
          return
        }
        setOpen(next)
      }}
      onOpenChangeComplete={(next) => {
        if (!next) setSession(createConnectionSession())
      }}
    >
      <DialogTrigger render={<Button variant="primary" />}>
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
        {session.step === 'details' && session.verification.status === 'verified' ? (
          <ExternalAgentDetailsForm
            agent={session.verification.agent}
            initialDetails={session.details}
            onBack={(details) =>
              setSession((current) => ({ ...current, details, step: 'connection' }))
            }
            onSave={(details) => {
              onConnect(details)
              setOpen(false)
            }}
          />
        ) : (
          <ExternalConnectionForm
            endpointRef={endpointRef}
            initialSettings={session.settings}
            verification={session.verification}
            onVerify={(settings) => {
              void verify(settings)
            }}
            onContinue={() => setSession((current) => ({ ...current, step: 'details' }))}
            onInvalidate={() =>
              setSession((current) =>
                current.verification.status === 'unverified'
                  ? current
                  : { ...current, verification: { status: 'unverified' } },
              )
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
