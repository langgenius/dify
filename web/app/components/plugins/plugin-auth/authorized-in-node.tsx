import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { Credential, PluginPayload } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { RiArrowDownSLine } from '@remixicon/react'
import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Authorized, usePluginAuth } from '.'

type AuthorizedInNodeProps = {
  pluginPayload: PluginPayload
  onAuthorizationItemClick: (id: string) => void
  credentialId?: string
  onDefaultCredentialChange?: (id?: string) => void
}
const AuthorizedInNode = ({
  pluginPayload,
  onAuthorizationItemClick,
  credentialId,
  onDefaultCredentialChange,
}: AuthorizedInNodeProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const {
    canApiKey,
    canOAuth,
    credentials,
    invalidPluginCredentialInfo,
    notAllowCustomCredential,
  } = usePluginAuth(pluginPayload, true, credentialId ? [credentialId] : undefined)
  const defaultCredentialId = credentials.find((c) => c.is_default)?.id

  useEffect(() => {
    onDefaultCredentialChange?.(defaultCredentialId)
  }, [defaultCredentialId, onDefaultCredentialChange])

  const renderTrigger = useCallback(
    (open?: boolean) => {
      let label = ''
      let removed = false
      let unavailable = false
      let color: StatusDotStatus = 'success'
      let defaultUnavailable = false
      if (!credentialId) {
        label = t(($) => $['auth.workspaceDefault'], { ns: 'plugin' })

        const defaultCredential = credentials.find((c) => c.is_default)

        if (defaultCredential?.not_allowed_to_use) {
          color = 'disabled'
          defaultUnavailable = true
        }
      } else {
        const credential = credentials.find((c) => c.id === credentialId)
        label = credential ? credential.name : t(($) => $['auth.authRemoved'], { ns: 'plugin' })
        removed = !credential
        unavailable = !!credential?.not_allowed_to_use && !credential?.from_enterprise

        if (removed) color = 'error'
        else if (unavailable) color = 'disabled'
      }
      return (
        <Button
          size="small"
          className={cn(
            open && !removed && 'bg-components-button-ghost-bg-hover',
            removed && 'bg-transparent text-text-destructive',
          )}
          variant={defaultUnavailable || unavailable ? 'ghost' : 'secondary'}
        >
          <StatusDot className="mr-1.5" status={color} />
          {label}
          {(unavailable || defaultUnavailable) && (
            <>
              &nbsp;
              {t(($) => $['auth.unavailable'], { ns: 'plugin' })}
            </>
          )}
          <RiArrowDownSLine
            className={cn(
              'size-3.5 text-components-button-ghost-text',
              removed && 'text-text-destructive',
            )}
          />
        </Button>
      )
    },
    [credentialId, credentials, t],
  )
  const defaultUnavailable = credentials.find((c) => c.is_default)?.not_allowed_to_use
  const extraAuthorizationItems: Credential[] = [
    {
      id: '__workspace_default__',
      name: t(($) => $['auth.workspaceDefault'], { ns: 'plugin' }),
      provider: '',
      is_default: !credentialId,
      isWorkspaceDefault: true,
      not_allowed_to_use: defaultUnavailable,
    },
  ]
  const handleAuthorizationItemClick = useCallback(
    (id: string) => {
      onAuthorizationItemClick(
        id === '__workspace_default__' && onDefaultCredentialChange
          ? defaultCredentialId || id
          : id,
      )
      setIsOpen(false)
    },
    [defaultCredentialId, onDefaultCredentialChange, onAuthorizationItemClick, setIsOpen],
  )

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
      placement="bottom-end"
      triggerPopupSameWidth={false}
      popupClassName="w-[360px]"
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
