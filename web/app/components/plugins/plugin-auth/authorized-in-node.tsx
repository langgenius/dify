import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'
import type {
  Credential,
  PluginPayload,
} from './types'
import {
  Authorized,
  usePluginAuth,
} from '.'

type AuthorizedInNodeProps = {
  pluginPayload: PluginPayload
  onAuthorizationItemClick: (id: string) => void
  credentialId?: string
}
const AuthorizedInNode = ({
  pluginPayload,
  onAuthorizationItemClick,
  credentialId,
}: AuthorizedInNodeProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const {
    canApiKey,
    canOAuth,
    credentials,
    disabled,
    invalidPluginCredentialInfo,
    notAllowCustomCredential,
  } = usePluginAuth(pluginPayload, true)
  const renderTrigger = useCallback((open?: boolean) => {
    let label = ''
    let removed = false
    let unavailable = false
    let color = 'green'
    let defaultUnavailable = false
    if (!credentialId) {
      label = t('plugin.auth.workspaceDefault')

      const defaultCredential = credentials.find(c => c.is_default)

      if (defaultCredential?.not_allowed_to_use) {
        color = 'gray'
        defaultUnavailable = true
      }
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
        size='small'
        className={cn(
          open && !removed && 'bg-components-button-ghost-bg-hover',
          removed && 'bg-transparent text-text-destructive',
        )}
        variant={(defaultUnavailable || unavailable) ? 'ghost' : 'secondary'}
      >
        <Indicator
          className='mr-1.5'
          color={color as any}
        />
        {label}
        {
          (unavailable || defaultUnavailable) && (
            <>
              &nbsp;
              {t('plugin.auth.unavailable')}
            </>
          )
        }
        <RiArrowDownSLine
          className={cn(
            'h-3.5 w-3.5 text-components-button-ghost-text',
            removed && 'text-text-destructive',
          )}
        />
      </Button>
    )
  }, [credentialId, credentials, t])
  const defaultUnavailable = credentials.find(c => c.is_default)?.not_allowed_to_use
  const extraAuthorizationItems: Credential[] = [
    {
      id: '__workspace_default__',
      name: t('plugin.auth.workspaceDefault'),
      provider: '',
      is_default: !credentialId,
      isWorkspaceDefault: true,
      not_allowed_to_use: defaultUnavailable,
    },
  ]
  const handleAuthorizationItemClick = useCallback((id: string) => {
    onAuthorizationItemClick(id)
    setIsOpen(false)
  }, [
    onAuthorizationItemClick,
    setIsOpen,
  ])

  return (
    <Authorized
      pluginPayload={pluginPayload}
      credentials={credentials}
      canOAuth={canOAuth}
      canApiKey={canApiKey}
      renderTrigger={renderTrigger}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      offset={4}
      placement='bottom-end'
      triggerPopupSameWidth={false}
      popupClassName='w-[360px]'
      disabled={disabled}
      disableSetDefault
      onItemClick={handleAuthorizationItemClick}
      extraAuthorizationItems={extraAuthorizationItems}
      showItemSelectedIcon
      selectedCredentialId={credentialId || '__workspace_default__'}
      onUpdate={invalidPluginCredentialInfo}
      notAllowCustomCredential={notAllowCustomCredential}
    />
  )
}

export default memo(AuthorizedInNode)
