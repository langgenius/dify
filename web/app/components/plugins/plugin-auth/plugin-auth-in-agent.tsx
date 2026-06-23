import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type {
  Credential,
  PluginPayload,
} from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { RiArrowDownSLine } from '@remixicon/react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from '#i18n'
import Authorize from './authorize'
import Authorized from './authorized'
import { usePluginAuth } from './hooks/use-plugin-auth'

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
    invalidPluginCredentialInfo,
    notAllowCustomCredential,
  } = usePluginAuth(pluginPayload, true, credentialId ? [credentialId] : undefined)

  const extraAuthorizationItems: Credential[] = [
    {
      id: '__workspace_default__',
      name: t('auth.workspaceDefault', { ns: 'plugin' }),
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
    let color: StatusDotStatus = 'success'
    if (!credentialId) {
      label = t('auth.workspaceDefault', { ns: 'plugin' })
    }
    else {
      const credential = credentials.find(c => c.id === credentialId)
      label = credential ? credential.name : t('auth.authRemoved', { ns: 'plugin' })
      removed = !credential
      unavailable = !!credential?.not_allowed_to_use && !credential?.from_enterprise
      if (removed)
        color = 'error'
      else if (unavailable)
        color = 'disabled'
    }
    return (
      <Button
        className={cn(
          'w-full',
          isOpen && 'bg-components-button-secondary-bg-hover',
          removed && 'text-text-destructive',
        )}
      >
        <StatusDot
          className="mr-2"
          status={color}
        />
        {label}
        {
          unavailable && t('auth.unavailable', { ns: 'plugin' })
        }
        <RiArrowDownSLine className="ml-0.5 size-4" />
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
