import {
  memo,
  useCallback,
  useState,
} from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Authorize from './authorize'
import Authorized from './authorized'
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
}
const PluginAuthInAgent = ({
  pluginPayload,
  credentialId,
  onAuthorizationItemClick,
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
  } = usePluginAuth(pluginPayload, true)

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

  return (
    <>
      {
        !isAuthorized && (
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={canOAuth}
            canApiKey={canApiKey}
            disabled={disabled}
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
            disabled={disabled}
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
    </>
  )
}

export default memo(PluginAuthInAgent)
