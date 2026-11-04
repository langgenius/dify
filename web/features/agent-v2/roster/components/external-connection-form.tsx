import type { RefObject } from 'react'
import type {
  ExternalConnectionSettings,
  ExternalConnectionVerificationState,
} from './external-connection-verification'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { DialogBody, DialogClose, DialogFooter } from '@langgenius/dify-ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldValidity,
} from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupInput } from '@langgenius/dify-ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useMergedRefs } from '@langgenius/dify-ui/use-merged-refs'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalConnectionSteps } from './external-connection-steps'

type ExternalConnectionFormProps = {
  initialSettings: ExternalConnectionSettings
  verification: ExternalConnectionVerificationState
  endpointRef: RefObject<HTMLInputElement | null>
  onVerify: (settings: ExternalConnectionSettings) => void
  onContinue: () => void
  onInvalidate: () => void
}

function focusEndpoint(input: HTMLInputElement | null) {
  input?.focus()
}

export function ExternalConnectionForm({
  initialSettings,
  verification,
  endpointRef,
  onVerify,
  onContinue,
  onInvalidate,
}: ExternalConnectionFormProps) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const inputRef = useMergedRefs(endpointRef, focusEndpoint)
  const [draft, setDraft] = useState(initialSettings)
  const submitLabelId = useId()
  const pending = verification.status === 'verifying'
  const verified = verification.status === 'verified'
  const error = verification.status === 'failed' ? verification.reason : null
  const options = [
    { value: 'none', label: t(($) => $['external.connection.none']) },
    { value: 'bearer', label: t(($) => $['external.connection.bearerToken']) },
  ]
  const errors = {
    unreachable: t(($) => $['external.connection.errors.unreachable']),
    authentication: t(($) => $['external.connection.errors.authentication']),
    unsupported: t(($) => $['external.connection.errors.unsupported']),
    'invalid-agent-card': t(($) => $['external.connection.errors.invalidAgentCard']),
    unknown: t(($) => $['external.connection.errors.unknown']),
  }

  function updateSetting<K extends keyof ExternalConnectionSettings>(
    name: K,
    value: ExternalConnectionSettings[K],
  ) {
    if (pending || draft[name] === value) return
    setDraft({ ...draft, [name]: value })
    onInvalidate()
  }

  return (
    <Form<Pick<ExternalConnectionSettings, 'endpoint' | 'token'>>
      className="contents"
      onFormSubmit={(values) => {
        if (pending) return
        if (verified) {
          onContinue()
          return
        }
        onVerify({
          endpoint: values.endpoint.trim(),
          authentication: draft.authentication,
          token: draft.authentication === 'bearer' ? values.token.trim() : '',
        })
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        <ExternalConnectionSteps step="connection" />
        <Field
          name="endpoint"
          disabled={pending}
          className="flex flex-col gap-1.5"
          validate={(value) => {
            if (typeof value !== 'string' || !value.trim())
              return t(($) => $['external.connection.endpointRequired'])
            try {
              const url = new URL(value.trim())
              if (url.protocol === 'http:' || url.protocol === 'https:') return null
            } catch {}
            return t(($) => $['external.connection.endpointInvalid'])
          }}
        >
          <FieldLabel>{t(($) => $['external.connection.endpoint'])}</FieldLabel>
          <Input
            ref={inputRef}
            value={draft.endpoint}
            onValueChange={(value) => updateSetting('endpoint', value)}
            placeholder="https://"
            type="url"
            autoComplete="url"
            required
          />
          <FieldValidity>
            {({ validity, error }) => (
              <FieldError>
                {validity.valueMissing
                  ? t(($) => $['external.connection.endpointRequired'])
                  : validity.typeMismatch
                    ? t(($) => $['external.connection.endpointInvalid'])
                    : error}
              </FieldError>
            )}
          </FieldValidity>
        </Field>
        <div className="h-px bg-divider-subtle" />
        <Select<'none' | 'bearer'>
          disabled={pending}
          items={options}
          value={draft.authentication}
          onValueChange={(value) => {
            if (value) updateSetting('authentication', value)
          }}
        >
          <div className="flex flex-col gap-1">
            <SelectLabel>{t(($) => $['external.connection.authentication'])}</SelectLabel>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </div>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <SelectItemText>{option.label}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {draft.authentication === 'bearer' && (
          <Field
            name="token"
            disabled={pending}
            className="flex flex-col gap-1.5"
            validate={(value) =>
              typeof value === 'string' && value.trim()
                ? null
                : t(($) => $['external.connection.tokenRequired'])
            }
          >
            <FieldLabel>{t(($) => $['external.connection.token'])}</FieldLabel>
            <InputGroup className="relative">
              <InputGroupInput
                type="password"
                autoComplete="off"
                placeholder={t(($) => $['external.connection.tokenPlaceholder'])}
                value={draft.token}
                onValueChange={(value) => updateSetting('token', value)}
                required
              />
              {verified && (
                <FieldDescription
                  role="status"
                  className="pointer-events-none absolute start-0 -top-1 flex items-center gap-1 py-0 system-xs-medium text-text-success"
                >
                  <span aria-hidden className="i-ri-check-line size-3.5" />
                  {t(($) => $['external.connection.statusVerified'])}
                </FieldDescription>
              )}
            </InputGroup>
            <FieldError>{t(($) => $['external.connection.tokenRequired'])}</FieldError>
          </Field>
        )}
        {error && (
          <Alert type="error">
            <AlertTitle>{errors[error]}</AlertTitle>
            {error === 'invalid-agent-card' && (
              <AlertDescription>
                {t(($) => $['external.connection.invalidAgentCardDetail'])}
              </AlertDescription>
            )}
          </Alert>
        )}
      </DialogBody>
      <DialogFooter>
        {verified && draft.authentication === 'none' && (
          <span
            role="status"
            className="me-auto flex items-center gap-1 system-xs-medium text-text-success"
          >
            <span aria-hidden className="i-ri-check-line size-3.5" />
            {t(($) => $['external.connection.statusVerified'])}
          </span>
        )}
        <DialogClose disabled={pending} render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} aria-labelledby={submitLabelId}>
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
