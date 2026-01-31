'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import AlertTriangle from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback/AlertTriangle'
import Input from '@/app/components/base/input'
import Switch from '@/app/components/base/switch'
import { API_PREFIX } from '@/config'
import { cn } from '@/utils/classnames'

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
            defaultValue={isDynamicRegistration}
            onChange={onDynamicRegistrationChange}
          />
          <span className="system-sm-medium text-text-secondary">{t('mcp.modal.useDynamicClientRegistration', { ns: 'tools' })}</span>
        </div>
        {!isDynamicRegistration && (
          <div className="mt-2 flex gap-2 rounded-lg bg-state-warning-hover p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-warning" />
            <div className="system-xs-regular text-text-secondary">
              <div className="mb-1">{t('mcp.modal.redirectUrlWarning', { ns: 'tools' })}</div>
              <code className="system-xs-medium block break-all rounded bg-state-warning-active px-2 py-1 text-text-secondary">
                {`${API_PREFIX}/mcp/oauth/callback`}
              </code>
            </div>
          </div>
        )}
      </div>
      <div>
        <div className={cn('mb-1 flex h-6 items-center', isDynamicRegistration && 'opacity-50')}>
          <span className="system-sm-medium text-text-secondary">{t('mcp.modal.clientID', { ns: 'tools' })}</span>
        </div>
        <Input
          value={clientID}
          onChange={e => onClientIDChange(e.target.value)}
          placeholder={t('mcp.modal.clientID', { ns: 'tools' })}
          disabled={isDynamicRegistration}
        />
      </div>
      <div>
        <div className={cn('mb-1 flex h-6 items-center', isDynamicRegistration && 'opacity-50')}>
          <span className="system-sm-medium text-text-secondary">{t('mcp.modal.clientSecret', { ns: 'tools' })}</span>
        </div>
        <Input
          value={credentials}
          onChange={e => onCredentialsChange(e.target.value)}
          placeholder={t('mcp.modal.clientSecretPlaceholder', { ns: 'tools' })}
          disabled={isDynamicRegistration}
        />
      </div>
    </>
  )
}

export default AuthenticationSection
