import type { RefObject } from 'react'
import type {
  ExternalConnectionSettings,
  ExternalConnectionVerificationState,
} from './external-connection-verification'
import { Button } from '@langgenius/dify-ui/button'
import { DialogBody, DialogClose, DialogFooter } from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { externalConnectionFailure } from './external-connection-errors'
import { ExternalConnectionFeedback } from './external-connection-feedback'
import { ExternalConnectionFields } from './external-connection-fields'
import { ExternalConnectionSteps } from './external-connection-steps'

type ExternalConnectionFormProps = {
  initialSettings: ExternalConnectionSettings
  savedSettings?: Pick<ExternalConnectionSettings, 'endpoint' | 'authentication'>
  endpointDescription?: string
  verification: ExternalConnectionVerificationState
  endpointRef: RefObject<HTMLInputElement | null>
  onVerify: (settings: ExternalConnectionSettings) => void
  onContinue: () => void
  onInvalidate: () => void
  executionEnabled?: boolean
  hasCredential?: boolean
}

export function ExternalConnectionForm({
  initialSettings,
  savedSettings,
  endpointDescription,
  verification,
  endpointRef,
  onVerify,
  onContinue,
  onInvalidate,
  executionEnabled = true,
  hasCredential = false,
}: ExternalConnectionFormProps) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [draft, setDraft] = useState(initialSettings)
  const submitLabelId = useId()
  const pending = verification.status === 'verifying'
  const verified = verification.status === 'verified'
  const changed =
    !savedSettings ||
    draft.endpoint.trim() !== savedSettings.endpoint.trim() ||
    draft.authentication !== savedSettings.authentication ||
    (draft.authentication === 'bearer' && draft.token !== '')
  const failure = externalConnectionFailure(verification, draft, hasCredential, t)

  return (
    <Form<Pick<ExternalConnectionSettings, 'endpoint' | 'token'>>
      className="contents"
      errors={failure?.field ? { [failure.field]: failure.message } : undefined}
      onFormSubmit={(values) => {
        if (pending) return
        if (verified) {
          onContinue()
          return
        }
        if (!executionEnabled || !changed) return
        onVerify({
          endpoint: values.endpoint.trim(),
          authentication: draft.authentication,
          token: draft.authentication === 'bearer' ? (values.token ?? '') : '',
        })
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        <ExternalConnectionSteps step="connection" />
        <ExternalConnectionFields
          settings={draft}
          endpointRef={endpointRef}
          disabled={pending}
          hasCredential={hasCredential}
          verified={verified}
          endpointDescription={endpointDescription}
          showEndpointDivider={!savedSettings}
          onChange={(settings) => {
            if (pending) return
            setDraft(settings)
            onInvalidate()
          }}
        />
        <ExternalConnectionFeedback
          verification={verification}
          failure={failure}
          executionEnabled={executionEnabled}
        />
      </DialogBody>
      <DialogFooter>
        <DialogClose disabled={pending} render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button
          type="submit"
          onClick={(event) => {
            if (verification.status !== 'failed') return
            event.preventDefault()
            const form = event.currentTarget.form
            onInvalidate()
            // Let the field errors clear before native submission validates the unchanged values.
            queueMicrotask(() => form?.requestSubmit())
          }}
          variant="primary"
          loading={pending}
          disabled={!verified && (!executionEnabled || !changed)}
          aria-labelledby={submitLabelId}
        >
          <span id={submitLabelId}>
            {pending
              ? t(($) => $['external.connection.verifying'])
              : verified
                ? t(($) => $['external.connection.continue'])
                : t(($) => $['external.connection.verify'])}
          </span>
        </Button>
      </DialogFooter>
    </Form>
  )
}
