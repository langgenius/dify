import type { RefObject } from 'react'
import type {
  ExternalConnectionSettings,
  ExternalConnectionVerificationState,
} from './external-connection-verification'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
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
  executionEnabled?: boolean
  hasCredential?: boolean
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
  executionEnabled = true,
  hasCredential = false,
}: ExternalConnectionFormProps) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const inputRef = useMergedRefs(endpointRef, focusEndpoint)
  const [draft, setDraft] = useState(initialSettings)
  const submitLabelId = useId()
  const pending = verification.status === 'verifying'
  const verified = verification.status === 'verified'
  const options = [
    { value: 'none', label: t(($) => $['external.connection.none']) },
    { value: 'bearer', label: t(($) => $['external.connection.bearerToken']) },
  ]
  const verifiedLabel =
    verified && verification.evidence.auth_check === 'passed_for_read_endpoint'
      ? t(($) => $['external.connection.authReadPassed'])
      : t(($) => $['external.connection.authNotExercised'])

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
        if (!executionEnabled) return
        onVerify({
          endpoint: values.endpoint.trim(),
          authentication: draft.authentication,
          token: draft.authentication === 'bearer' ? (values.token ?? '') : '',
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
            maxLength={4096}
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
            validate={(value) => {
              if (!value && (hasCredential || verified)) return null
              if (typeof value !== 'string' || !value)
                return t(($) => $['external.connection.tokenRequired'])
              return value.length <= 8192 && /^[\w.~+/-]+=*$/.test(value)
                ? null
                : t(($) => $['external.connection.tokenInvalid'])
            }}
          >
            <FieldLabel>{t(($) => $['external.connection.token'])}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                type="password"
                autoComplete="off"
                placeholder={t(($) => $['external.connection.tokenPlaceholder'])}
                value={draft.token}
                onValueChange={(value) => updateSetting('token', value)}
                required={!hasCredential && !verified}
                maxLength={8192}
              />
            </InputGroup>
            {hasCredential && (
              <FieldDescription>{t(($) => $['external.connection.keepToken'])}</FieldDescription>
            )}
            <FieldValidity>
              {({ validity, error }) => (
                <FieldError>
                  {validity.valueMissing ? t(($) => $['external.connection.tokenRequired']) : error}
                </FieldError>
              )}
            </FieldValidity>
          </Field>
        )}
        {verified && (
          <p role="status" className="system-xs-regular text-text-success">
            {verifiedLabel}
          </p>
        )}
        {verification.status === 'failed' && (
          <Alert type="error">
            <AlertTitle>
              {verification.message || t(($) => $['external.connection.errors.unknown'])}
            </AlertTitle>
          </Alert>
        )}
        {verification.status === 'expired' && (
          <Alert type="warning">
            <AlertTitle>{t(($) => $['external.connection.proofExpired'])}</AlertTitle>
          </Alert>
        )}
        {!executionEnabled && !verified && (
          <Alert type="warning">
            <AlertTitle>{t(($) => $['external.api.executionDisabled'])}</AlertTitle>
          </Alert>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose disabled={pending} render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          disabled={!verified && !executionEnabled}
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
