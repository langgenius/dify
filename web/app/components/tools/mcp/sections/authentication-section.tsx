'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Switch } from '@langgenius/dify-ui/switch'
import { useTranslation } from 'react-i18next'
import AlertTriangle from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback/AlertTriangle'
import { API_PREFIX } from '@/config'

type AuthenticationSectionProps = {
  isDynamicRegistration: boolean
  onDynamicRegistrationChange: (value: boolean) => void
  clientID: string
  onClientIDChange: (value: string) => void
  credentials: string
  onCredentialsChange: (value: string) => void
}

const AuthenticationSection: FC<AuthenticationSectionProps> = ({
  isDynamicRegistration,
  onDynamicRegistrationChange,
  clientID,
  onClientIDChange,
  credentials,
  onCredentialsChange,
}) => {
  const { t } = useTranslation()

  return (
    <>
      <div>
        <div className="mb-1 flex h-6 items-center">
          <Switch
            className="mr-2"
            checked={isDynamicRegistration}
            onCheckedChange={onDynamicRegistrationChange}
            aria-labelledby="mcp-dynamic-client-registration-label"
          />
          <span
            id="mcp-dynamic-client-registration-label"
            className="system-sm-medium text-text-secondary"
          >
            {t(($) => $['mcp.modal.useDynamicClientRegistration'], { ns: 'tools' })}
          </span>
        </div>
        {!isDynamicRegistration && (
          <div className="mt-2 flex gap-2 rounded-lg bg-state-warning-hover p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-text-warning" />
            <div className="system-xs-regular text-text-secondary">
              <div className="mb-1">
                {t(($) => $['mcp.modal.redirectUrlWarning'], { ns: 'tools' })}
              </div>
              <code className="block rounded-sm bg-state-warning-active px-2 py-1 system-xs-medium break-all text-text-secondary">
                {`${API_PREFIX}/mcp/oauth/callback`}
              </code>
            </div>
          </div>
        )}
      </div>
      <Field name="client_id" className="gap-0">
        <FieldLabel
          className={cn(
            'mb-1 flex h-6 items-center system-sm-medium text-text-secondary',
            isDynamicRegistration && 'opacity-50',
          )}
        >
          {t(($) => $['mcp.modal.clientID'], { ns: 'tools' })}
        </FieldLabel>
        <FieldControl
          value={clientID}
          onChange={(e) => onClientIDChange(e.target.value)}
          placeholder={t(($) => $['mcp.modal.clientID'], { ns: 'tools' })}
          disabled={isDynamicRegistration}
        />
      </Field>
      <Field name="client_secret" className="gap-0">
        <FieldLabel
          className={cn(
            'mb-1 flex h-6 items-center system-sm-medium text-text-secondary',
            isDynamicRegistration && 'opacity-50',
          )}
        >
          {t(($) => $['mcp.modal.clientSecret'], { ns: 'tools' })}
        </FieldLabel>
        <FieldControl
          value={credentials}
          onChange={(e) => onCredentialsChange(e.target.value)}
          placeholder={t(($) => $['mcp.modal.clientSecretPlaceholder'], { ns: 'tools' })}
          disabled={isDynamicRegistration}
        />
      </Field>
    </>
  )
}

export default AuthenticationSection
