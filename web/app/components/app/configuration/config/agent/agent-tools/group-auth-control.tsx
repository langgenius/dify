'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import Authorize from '@/app/components/plugins/plugin-auth/authorize'
import Authorized from '@/app/components/plugins/plugin-auth/authorized'
import { AuthCategory } from '@/app/components/plugins/plugin-auth'
import { usePluginAuth } from '@/app/components/plugins/plugin-auth/hooks/use-plugin-auth'
import type { Credential } from '@/app/components/plugins/plugin-auth/types'
import cn from '@/utils/classnames'
import type { CollectionType } from '@/app/components/tools/types'

type GroupAuthControlProps = {
  providerId: string
  providerName: string
  providerType: CollectionType
  credentialId?: string
  onChange: (credentialId: string) => void
}

const GroupAuthControl: FC<GroupAuthControlProps> = ({
  providerId,
  providerName,
  providerType,
  credentialId,
  onChange,
}) => {
  const { t } = useTranslation()
  const {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials,
    disabled,
    invalidPluginCredentialInfo,
    notAllowCustomCredential,
  } = usePluginAuth({
    provider: providerName,
    providerType,
    category: AuthCategory.tool,
    detail: { id: providerId, name: providerName, type: providerType } as any,
  }, true)

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
    onChange(id === '__workspace_default__' ? '' : id)
  }, [onChange])

  const renderTrigger = useCallback((open?: boolean) => {
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
          'h-9',
          open && 'bg-components-button-secondary-bg-hover',
          removed && 'text-text-destructive',
        )}
        variant='secondary'
        size='small'
      >
        <Indicator className='mr-2' color={color as any} />
        {label}
        {
          unavailable && t('plugin.auth.unavailable')
        }
        <RiArrowDownSLine className='ml-0.5 h-4 w-4' />
      </Button>
    )
  }, [credentialId, credentials, t])

  if (!isAuthorized) {
    return (
      <Authorize
        pluginPayload={{
          provider: providerName,
          providerType,
          category: AuthCategory.tool,
          detail: { id: providerId, name: providerName, type: providerType } as any,
        }}
        canOAuth={canOAuth}
        canApiKey={canApiKey}
        disabled={disabled}
        onUpdate={invalidPluginCredentialInfo}
        notAllowCustomCredential={notAllowCustomCredential}
      />
    )
  }

  return (
    <Authorized
      pluginPayload={{
        provider: providerName,
        providerType,
        category: AuthCategory.tool,
        detail: { id: providerId, name: providerName, type: providerType } as any,
      }}
      credentials={credentials}
      canOAuth={canOAuth}
      canApiKey={canApiKey}
      disabled={disabled}
      disableSetDefault
      onItemClick={handleAuthorizationItemClick}
      extraAuthorizationItems={extraAuthorizationItems}
      showItemSelectedIcon
      renderTrigger={renderTrigger}
      selectedCredentialId={credentialId || '__workspace_default__'}
      onUpdate={invalidPluginCredentialInfo}
      notAllowCustomCredential={notAllowCustomCredential}
    />
  )
}

export default React.memo(GroupAuthControl)
