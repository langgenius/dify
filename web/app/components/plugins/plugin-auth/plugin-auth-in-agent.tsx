import {
  memo,
  useCallback,
  useState,
} from 'react'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Authorize from './authorize'
import Authorized from './authorized'
import CredentialConfigHeader from './credential-config-header'
import EndUserCredentialSection from './end-user-credential-section'
import type {
  Credential,
  PluginPayload,
} from './types'
import { usePluginAuth } from './hooks/use-plugin-auth'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'

type PluginAuthInAgentProps = {
  pluginPayload: PluginPayload
  credentialId?: string
  onAuthorizationItemClick?: (id: string) => void
  useEndUserCredentialEnabled?: boolean
  endUserCredentialType?: string
  onEndUserCredentialChange?: (enabled: boolean) => void
  onEndUserCredentialTypeChange?: (type: string) => void
}
const PluginAuthInAgent = ({
  pluginPayload,
  credentialId,
  onAuthorizationItemClick,
  useEndUserCredentialEnabled,
  endUserCredentialType,
  onEndUserCredentialChange,
  onEndUserCredentialTypeChange,
}: PluginAuthInAgentProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials,
    disabled,
    invalidPluginCredentialInfo,
    notAllowCustomCredential,
    hasOAuthClientConfigured,
  } = usePluginAuth(pluginPayload, true)

  const configuredDisabled = !!useEndUserCredentialEnabled

  const extraAuthorizationItems: Credential[] = [
    {
      id: '__workspace_default__',
      name: t('plugin.auth.workspaceDefault'),
      provider: '',
      is_default: !credentialId,
      isWorkspaceDefault: true,
    },
  ]

  const handleAuthorizationItemClick = useCallback((id: string) => {
    onAuthorizationItemClick?.(id)
    setIsOpen(false)
  }, [
    onAuthorizationItemClick,
    setIsOpen,
  ])

  const renderTrigger = useCallback((isOpen?: boolean) => {
    let label = ''
    let removed = false
    let unavailable = false
    let color = 'green'
    if (!credentialId) {
      label = t('plugin.auth.workspaceDefault')
    }
    else {
      const credential = credentials.find(c => c.id === credentialId)
      label = credential ? credential.name : t('plugin.auth.authRemoved')
      removed = !credential
      unavailable = !!credential?.not_allowed_to_use && !credential?.from_enterprise
      if (removed)
        color = 'red'
      else if (unavailable)
        color = 'gray'
    }
    return (
      <Button
        className={cn(
          'w-full',
          isOpen && 'bg-components-button-secondary-bg-hover',
          removed && 'text-text-destructive',
        )}>
        <Indicator
          className='mr-2'
          color={color as any}
        />
        {label}
        {
          unavailable && t('plugin.auth.unavailable')
        }
        <RiArrowDownSLine className='ml-0.5 h-4 w-4' />
      </Button>
    )
  }, [credentialId, credentials, t])

  const shouldShowAuthorizeCard = !credentials.length && (canOAuth || canApiKey || hasOAuthClientConfigured)

  return (
    <div className='border-components-panel-border bg-components-panel-bg'>
      <div className={cn(configuredDisabled && 'pointer-events-none opacity-50')}>
        <CredentialConfigHeader
          pluginPayload={pluginPayload}
          canOAuth={canOAuth}
          canApiKey={canApiKey}
          hasOAuthClientConfigured={hasOAuthClientConfigured}
          disabled={disabled || configuredDisabled}
          onCredentialAdded={invalidPluginCredentialInfo}
        />
      </div>
      <div className={cn(configuredDisabled && 'pointer-events-none opacity-50')}>
        {
          !isAuthorized && shouldShowAuthorizeCard && (
            <div className='rounded-xl bg-background-section px-4 py-4'>
              <div className='flex w-full justify-center'>
                <div className='w-full max-w-[520px]'>
                  <Authorize
                    pluginPayload={pluginPayload}
                    canOAuth={canOAuth}
                    canApiKey={canApiKey}
                    disabled={disabled || configuredDisabled}
                    onUpdate={invalidPluginCredentialInfo}
                    notAllowCustomCredential={notAllowCustomCredential}
                    theme='secondary'
                    showDivider={!!(canOAuth && canApiKey)}
                  />
                </div>
              </div>
            </div>
          )
        }
        {
          !isAuthorized && !shouldShowAuthorizeCard && (
            <Authorize
              pluginPayload={pluginPayload}
              canOAuth={canOAuth}
              canApiKey={canApiKey}
              disabled={disabled || configuredDisabled}
              onUpdate={invalidPluginCredentialInfo}
              notAllowCustomCredential={notAllowCustomCredential}
            />
          )
        }
        {
          isAuthorized && (
            <Authorized
              pluginPayload={pluginPayload}
              credentials={credentials}
              canOAuth={canOAuth}
              canApiKey={canApiKey}
              disabled={disabled || configuredDisabled}
              disableSetDefault
              onItemClick={handleAuthorizationItemClick}
              extraAuthorizationItems={extraAuthorizationItems}
              showItemSelectedIcon
              renderTrigger={renderTrigger}
              isOpen={isOpen}
              onOpenChange={setIsOpen}
              selectedCredentialId={credentialId || '__workspace_default__'}
              onUpdate={invalidPluginCredentialInfo}
              notAllowCustomCredential={notAllowCustomCredential}
            />
          )
        }
      </div>
      <EndUserCredentialSection
        pluginPayload={pluginPayload}
        canOAuth={canOAuth}
        canApiKey={canApiKey}
        disabled={disabled}
        useEndUserCredentialEnabled={useEndUserCredentialEnabled}
        endUserCredentialType={endUserCredentialType}
        onEndUserCredentialChange={onEndUserCredentialChange}
        onEndUserCredentialTypeChange={onEndUserCredentialTypeChange}
        onCredentialAdded={invalidPluginCredentialInfo}
      />
    </div>
  )
}

export default memo(PluginAuthInAgent)
