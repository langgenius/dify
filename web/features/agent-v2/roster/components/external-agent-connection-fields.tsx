'use client'

import type { ExternalAgentAuthType } from '@dify/contracts/api/console/agent/types.gen'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'

const isLoopbackEndpoint = (endpoint: string) => {
  try {
    const hostname = new URL(endpoint).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

type ExternalAgentConnectionFieldsProps = {
  authType: ExternalAgentAuthType
  bearerToken: string
  endpoint: string
  disabled?: boolean
  onAuthTypeChange: (authType: ExternalAgentAuthType) => void
  onBearerTokenChange: (token: string) => void
  onEndpointChange: (endpoint: string) => void
  bearerTokenHelp?: string
  bearerTokenPlaceholder?: string
  bearerTokenRequired?: boolean
}

export function ExternalAgentConnectionFields({
  authType,
  bearerToken,
  endpoint,
  disabled,
  onAuthTypeChange,
  onBearerTokenChange,
  onEndpointChange,
  bearerTokenHelp,
  bearerTokenPlaceholder,
  bearerTokenRequired = true,
}: ExternalAgentConnectionFieldsProps) {
  const { t } = useTranslation('agentV2')
  const authLabels: Record<ExternalAgentAuthType, string> = {
    none: t(($) => $['externalAgent.auth.none']),
    bearer: t(($) => $['externalAgent.auth.bearer']),
  }

  return (
    <div className="space-y-5">
      <Field name="endpoint">
        <FieldLabel>{t(($) => $['externalAgent.endpoint.label'])}</FieldLabel>
        <FieldControl
          autoComplete="url"
          disabled={disabled}
          onValueChange={onEndpointChange}
          placeholder={t(($) => $['externalAgent.endpoint.placeholder'])}
          required
          type="url"
          value={endpoint}
        />
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['externalAgent.endpoint.help'])}
        </p>
        {isLoopbackEndpoint(endpoint) && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-state-warning-hover px-2.5 py-2 system-xs-regular text-text-warning">
            <span aria-hidden className="mt-0.5 i-ri-alert-fill size-3.5 shrink-0" />
            <span>{t(($) => $['externalAgent.endpoint.dockerHint'])}</span>
          </div>
        )}
      </Field>

      <Field name="auth_type">
        <FieldLabel>{t(($) => $['externalAgent.auth.label'])}</FieldLabel>
        <Select
          disabled={disabled}
          value={authType}
          onValueChange={(value) => {
            if (value === 'none' || value === 'bearer') onAuthTypeChange(value)
          }}
        >
          <SelectTrigger className="h-9 w-full px-3 text-left system-sm-regular">
            {authLabels[authType]}
          </SelectTrigger>
          <SelectContent popupClassName="w-(--anchor-width)">
            {(['none', 'bearer'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                <SelectItemText>{authLabels[value]}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {authType === 'bearer' && (
        <Field name="bearer_token">
          <FieldLabel>{t(($) => $['externalAgent.auth.tokenLabel'])}</FieldLabel>
          <FieldControl
            autoComplete="new-password"
            disabled={disabled}
            onValueChange={onBearerTokenChange}
            placeholder={
              bearerTokenPlaceholder ?? t(($) => $['externalAgent.auth.tokenPlaceholder'])
            }
            required={bearerTokenRequired}
            type="password"
            value={bearerToken}
          />
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {bearerTokenHelp ?? t(($) => $['externalAgent.auth.tokenHelp'])}
          </p>
        </Field>
      )}
    </div>
  )
}
