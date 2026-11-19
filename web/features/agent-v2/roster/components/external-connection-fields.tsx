import type { RefObject } from 'react'
import type { ExternalConnectionSettings } from './external-connection-verification'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldValidity,
} from '@langgenius/dify-ui/field'
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
import { useTranslation } from 'react-i18next'

type ExternalConnectionFieldsProps = {
  settings: ExternalConnectionSettings
  endpointRef: RefObject<HTMLInputElement | null>
  disabled?: boolean
  hasCredential?: boolean
  verified?: boolean
  endpointDescription?: string
  showEndpointDivider?: boolean
  onChange: (settings: ExternalConnectionSettings) => void
}

function focusEndpoint(input: HTMLInputElement | null) {
  input?.focus()
}

export function ExternalConnectionFields({
  settings,
  endpointRef,
  disabled = false,
  hasCredential = false,
  verified = false,
  endpointDescription,
  showEndpointDivider = false,
  onChange,
}: ExternalConnectionFieldsProps) {
  const { t } = useTranslation(['agentRoster'])
  const inputRef = useMergedRefs(endpointRef, focusEndpoint)
  const options = [
    { value: 'none', label: t(($) => $['external.connection.none']) },
    { value: 'bearer', label: t(($) => $['external.connection.bearerToken']) },
  ]
  function updateSetting<K extends keyof ExternalConnectionSettings>(
    name: K,
    value: ExternalConnectionSettings[K],
  ) {
    if (disabled || settings[name] === value) return
    onChange({ ...settings, [name]: value })
  }
  return (
    <>
      <Field
        name="endpoint"
        disabled={disabled}
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
          value={settings.endpoint}
          onValueChange={(value) => updateSetting('endpoint', value)}
          placeholder="https://"
          type="url"
          autoComplete="url"
          maxLength={4096}
          required
        />
        {endpointDescription && <FieldDescription>{endpointDescription}</FieldDescription>}
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
      {showEndpointDivider && <div className="h-px bg-divider-subtle" />}
      <Select<'none' | 'bearer'>
        disabled={disabled}
        items={options}
        value={settings.authentication}
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
      {settings.authentication === 'bearer' && (
        <Field
          name="token"
          disabled={disabled}
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
              placeholder={
                verified && settings.token === ''
                  ? '••••••••••••'
                  : t(($) => $['external.connection.tokenPlaceholder'])
              }
              value={settings.token}
              onValueChange={(value) => updateSetting('token', value)}
              required={!hasCredential && !verified}
              maxLength={8192}
            />
          </InputGroup>
          {hasCredential && !verified && (
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
    </>
  )
}
