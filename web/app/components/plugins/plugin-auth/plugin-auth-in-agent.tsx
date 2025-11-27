import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiEqualizer2Line,
  RiKey2Line,
  RiUserStarLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Authorize from './authorize'
import Authorized from './authorized'
import AddOAuthButton from './authorize/add-oauth-button'
import AddApiKeyButton from './authorize/add-api-key-button'
import type {
  Credential,
  PluginPayload,
} from './types'
import { usePluginAuth } from './hooks/use-plugin-auth'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Switch from '@/app/components/base/switch'

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
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showEndUserTypeMenu, setShowEndUserTypeMenu] = useState(false)
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

  const availableEndUserTypes = useMemo(() => {
    const list: { value: string; label: string; icon: ReactNode }[] = []
    if (canOAuth) {
      list.push({
        value: 'oauth2',
        label: t('plugin.auth.endUserCredentials.optionOAuth'),
        icon: <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />,
      })
    }
    if (canApiKey) {
      list.push({
        value: 'api-key',
        label: t('plugin.auth.endUserCredentials.optionApiKey'),
        icon: <RiKey2Line className='h-4 w-4 text-text-tertiary' />,
      })
    }
    return list
  }, [canOAuth, canApiKey, t])

  const endUserCredentialLabel = useMemo(() => {
    const found = availableEndUserTypes.find(item => item.value === endUserCredentialType)
    return found?.label || availableEndUserTypes[0]?.label || '-'
  }, [availableEndUserTypes, endUserCredentialType])

  useEffect(() => {
    if (!useEndUserCredentialEnabled)
      return
    if (!availableEndUserTypes.length)
      return
    const isValid = availableEndUserTypes.some(item => item.value === endUserCredentialType)
    if (!isValid)
      onEndUserCredentialTypeChange?.(availableEndUserTypes[0].value)
  }, [useEndUserCredentialEnabled, endUserCredentialType, availableEndUserTypes, onEndUserCredentialTypeChange])

  const handleSelectEndUserType = useCallback((value: string) => {
    onEndUserCredentialTypeChange?.(value)
    setShowEndUserTypeMenu(false)
  }, [onEndUserCredentialTypeChange])

  const shouldShowAuthorizeCard = !credentials.length && (canOAuth || canApiKey || hasOAuthClientConfigured)

  const endUserSection = (
    <div className='flex items-start rounded-lg border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-3 py-3'>
      <RiUserStarLine className='mt-0.5 h-4 w-4 text-text-tertiary' />
      <div className='flex-1 space-y-3'>
        <div className='flex items-center justify-between gap-3'>
          <div className='space-y-1'>
            <div className='system-sm-semibold text-text-primary'>
              {t('plugin.auth.endUserCredentials.title')}
            </div>
            <div className='system-xs-regular text-text-tertiary'>
              {t('plugin.auth.endUserCredentials.desc')}
            </div>
          </div>
          <Switch
            size='md'
            defaultValue={!!useEndUserCredentialEnabled}
            onChange={onEndUserCredentialChange}
            disabled={disabled}
          />
        </div>
        {
          useEndUserCredentialEnabled && availableEndUserTypes.length > 0 && (
            <div className='flex items-center justify-between gap-3'>
              <div className='system-sm-semibold text-text-primary'>
                {t('plugin.auth.endUserCredentials.typeLabel')}
              </div>
              <PortalToFollowElem
                open={showEndUserTypeMenu}
                onOpenChange={setShowEndUserTypeMenu}
                placement='bottom-end'
                offset={6}
              >
                <PortalToFollowElemTrigger asChild>
                  <button
                    type='button'
                    className='border-components-input-border flex h-9 min-w-[190px] items-center justify-between rounded-lg border bg-components-input-bg-normal px-3 text-left text-text-primary shadow-xs hover:bg-components-input-bg-hover'
                    onClick={() => setShowEndUserTypeMenu(v => !v)}
                  >
                    <span className='system-sm-semibold'>{endUserCredentialLabel}</span>
                    <RiArrowDownSLine className='h-4 w-4 text-text-tertiary' />
                  </button>
                </PortalToFollowElemTrigger>
                <PortalToFollowElemContent className='z-[120]'>
                  <div className='w-[220px] rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg'>
                    <div className='flex flex-col gap-1 p-1'>
                      {canOAuth && (
                        <AddOAuthButton
                          pluginPayload={pluginPayload}
                          buttonVariant='ghost'
                          className='w-full justify-between bg-transparent text-text-primary hover:bg-transparent'
                          buttonText={t('plugin.auth.addOAuth')}
                          disabled={disabled}
                          onUpdate={() => {
                            handleSelectEndUserType('oauth2')
                            invalidPluginCredentialInfo()
                          }}
                        />
                      )}
                      {canApiKey && (
                        <AddApiKeyButton
                          pluginPayload={pluginPayload}
                          buttonVariant='ghost'
                          buttonText={t('plugin.auth.addApi')}
                          disabled={disabled}
                          onUpdate={() => {
                            handleSelectEndUserType('api-key')
                            invalidPluginCredentialInfo()
                          }}
                        />
                      )}
                    </div>
                  </div>
                </PortalToFollowElemContent>
              </PortalToFollowElem>
            </div>
          )
        }
      </div>
    </div>
  )

  return (
    <div className='border-components-panel-border bg-components-panel-bg'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex items-start gap-2'>
          <RiKey2Line className='mt-0.5 h-4 w-4 text-text-tertiary' />
          <div className='space-y-0.5'>
            <div className='system-md-semibold text-text-primary'>
              {t('plugin.auth.configuredCredentials.title')}
            </div>
            <div className='system-xs-regular text-text-tertiary'>
              {t('plugin.auth.configuredCredentials.desc')}
            </div>
          </div>
        </div>
        <PortalToFollowElem
          open={showAddMenu}
          onOpenChange={setShowAddMenu}
          placement='bottom-end'
          offset={6}
        >
          <PortalToFollowElemTrigger asChild>
            <button
              type='button'
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-700',
                (disabled || (!canOAuth && !canApiKey && !hasOAuthClientConfigured)) && 'pointer-events-none opacity-50',
              )}
              onClick={() => setShowAddMenu(v => !v)}
            >
              <RiAddLine className='h-5 w-5' />
            </button>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className='z-[120]'>
            <div className='w-[220px] rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg'>
              <div className='flex flex-col gap-1 p-1'>
                {
                  canOAuth && (
                    <AddOAuthButton
                      pluginPayload={pluginPayload}
                      buttonVariant='ghost'
                      className='w-full justify-between bg-transparent text-text-primary hover:bg-transparent'
                      buttonText={t('plugin.auth.addOAuth')}
                      disabled={disabled}
                      onUpdate={() => {
                        setShowAddMenu(false)
                        invalidPluginCredentialInfo()
                      }}
                    />
                  )
                }
                {
                  canApiKey && (
                    <AddApiKeyButton
                      pluginPayload={pluginPayload}
                      buttonVariant='ghost'
                      buttonText={t('plugin.auth.addApi')}
                      disabled={disabled}
                      onUpdate={() => {
                        setShowAddMenu(false)
                        invalidPluginCredentialInfo()
                      }}
                    />
                  )
                }
              </div>
            </div>
          </PortalToFollowElemContent>
        </PortalToFollowElem>
      </div>
      {
        !isAuthorized && shouldShowAuthorizeCard && (
          <div className='rounded-xl bg-background-section px-4 py-4'>
            <div className='flex w-full justify-center'>
              <div className='w-full max-w-[520px]'>
                <Authorize
                  pluginPayload={pluginPayload}
                  canOAuth={canOAuth}
                  canApiKey={canApiKey}
                  disabled={disabled}
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
      {endUserSection}
    </div>
  )
}

export default memo(PluginAuthInAgent)
